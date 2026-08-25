import { sentryEnabled } from './instrument.js';
import express from 'express';
import * as Sentry from '@sentry/node';
import cors from 'cors';
import { config } from 'dotenv';
import { specs, swaggerUi, swaggerUiOptions } from '../swagger-setup.js';
import { connectControlPlane } from './db/controlPlane.js';
import { attachDb } from './middleware/attachDb.js';
import { authenticate, requireActiveTenant } from './middleware/auth.middleware.js';
import authRoutes from './routes/auth.routes.js';
import adminRoutes from './routes/admin.routes.js';
import companyRoutes from './routes/company.routes.js';
import tireRoutes from './routes/tire.routes.js';
import vehicleRoutes from './routes/vehicle.routes.js';
import orderRoutes from './routes/order.routes.js';
import { httpError } from './utils/httpError.js';

config();

const app = express();
const PORT = process.env.PORT || 4000;

// Middlewares
app.use(cors());
app.options('*', cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Swagger UI (solo para desarrollo local)
app.use('/api-docs', swaggerUi.serve);
app.get('/api-docs', swaggerUi.setup(specs, swaggerUiOptions));

// Rutas de documentación
app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(specs);
});

// Garantiza el control plane conectado ANTES de procesar la request. Idempotente
// (instantáneo si ya conectó). Necesario en serverless: el connectControlPlane() del cold
// start es async y no esperado → sin esto, las primeras requests al control plane fallan.
// En tests/local sin CONTROL_PLANE_URI es un no-op (los tests conectan por su cuenta).
app.use(async (req, res, next) => {
  try {
    if (process.env.CONTROL_PLANE_URI) await connectControlPlane();
    next();
  } catch (err) {
    next(err);
  }
});

// Auth (control plane) — público, no opera sobre la DB del tenant.
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
// Lectura de empresa (datos + receiptDesign) para cualquier rol autenticado — para imprimir.
app.use('/api/company', authenticate, requireActiveTenant, companyRoutes);

// Rutas de negocio: authenticate (verifica JWT) -> requireActiveTenant (tenant existe/activo)
// -> attachDb (resuelve la DB del tenant).
app.use('/api/tires', authenticate, requireActiveTenant, attachDb, tireRoutes);
app.use('/api/vehicles', authenticate, requireActiveTenant, attachDb, vehicleRoutes);
app.use('/api/orders', authenticate, requireActiveTenant, attachDb, orderRoutes);

// Rutas básicas
app.get('/', (req, res) => {
  res.json({
    message: 'API de Gestión de Cubiertas',
    version: '1.2.0',
    documentation: '/api-docs',
    environment: process.env.NODE_ENV || 'development',
    endpoints: {
      tires: '/api/tires',
      vehicles: '/api/vehicles'
    },
    status: 'online',
    cors: 'enabled'
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    cors: 'enabled'
  });
});

// Sentry captura las excepciones (5xx / no manejadas) ANTES del handler central. No-op si
// Sentry no esta activo (sin DSN o en tests). Va despues de las rutas, antes del error mw.
if (sentryEnabled) Sentry.setupExpressErrorHandler(app);

// Middleware de manejo de errores central: los handlers (vía asyncHandler) y los services
// tiran httpError(message, status, field); acá se serializa. Solo se loguea el 5xx (una falla
// real del server); un 4xx es input inválido esperado, no ruido de consola.
app.use((err, req, res, next) => {
  // Red de seguridad: dos errores de Mongo que, si se serializan crudos, filtran interna del
  // multi-tenant. El E11000 incluye "collection: <dbName>.<coleccion>", o sea el nombre de la
  // base del tenant. Cada endpoint debería pre-chequear con un mensaje propio; esto cubre el
  // que se olvide.
  if (err?.code === 11000) {
    const campo = Object.keys(err.keyValue || {})[0];
    const valor = campo ? err.keyValue[campo] : undefined;
    err = httpError(
      campo ? `Ya existe un registro con ese valor de "${campo}"${valor !== undefined ? ` (${valor})` : ''}` : 'Ya existe un registro con esos datos',
      400,
      campo,
    );
  } else if (err?.name === 'CastError') {
    err = httpError('Identificador inválido', 400, err.path);
  }

  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({
    message: err.message || 'Error interno',
    ...(err.field ? { field: err.field } : {}),
  });
});

// Middleware para rutas no encontradas
app.use('*', (req, res) => {
  res.status(404).json({
    message: 'Ruta no encontrada',
    path: req.originalUrl,
    method: req.method
  });
});

// app.js exporta una factory pura del app Express (sin side-effects de conexión ni
// listen), para poder importarlo en tests con supertest. Es la ÚNICA definición de rutas
// y middleware. El arranque real (conectar + listen) vive en server.js (local) y
// api/index.js (serverless) — ambos importan este app; NUNCA se montan rutas fuera de acá.
export default app;
