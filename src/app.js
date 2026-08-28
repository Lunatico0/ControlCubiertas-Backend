import { sentryEnabled } from './instrument.js';
import express from 'express';
import * as Sentry from '@sentry/node';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
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

// Cabeceras defensivas. `contentSecurityPolicy` va apagado porque Swagger UI se sirve desde
// esta misma app y su CSP por defecto le rompe los assets inline; esto es una API JSON, no
// una web que renderice HTML de terceros. `x-powered-by` se va con helmet.
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// CORS. La lista blanca se configura con CORS_ORIGINS (orígenes separados por coma).
//
// SIN esa variable el comportamiento es el histórico (cualquier origen), A PROPÓSITO: adivinar
// los dominios acá y equivocarse deja sin backend a toda la operación. Setear CORS_ORIGINS en
// Vercel es lo que cierra la puerta, y hacerlo no requiere tocar código.
//
// Las requests SIN cabecera Origin pasan siempre: es el caso de la app de escritorio, que
// carga por file:// y no manda Origin, además de curl y los health checks.
const origenesPermitidos = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const corsOptions = origenesPermitidos.length
  ? {
      origin: (origin, cb) => cb(null, !origin || origenesPermitidos.includes(origin)),
      credentials: true,
    }
  : {};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Límite del body EXPLÍCITO. El default de Express son 100 kb, y receiptDesign.logo se
// persiste como dataURL: un logo normal ya lo pasa y el tenant recibía un 413 con el HTML de
// error de Express, sin mensaje útil. 2 MB es holgado para un logo y sigue siendo un techo:
// lo que se guarda acá viaja en cada GET /api/company de todos los usuarios del tenant.
const BODY_LIMIT = process.env.BODY_LIMIT || '2mb';
app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));

// El 413 y el JSON malformado de body-parser tienen que salir como JSON: el front sólo sabe
// leer { message }. Sin esto llega el HTML de error de Express y el toast queda mudo.
app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ message: `El contenido enviado supera el límite de ${BODY_LIMIT}.` });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'El cuerpo de la petición no es JSON válido.' });
  }
  return next(err);
});

// Swagger UI: NUNCA en producción. vercel.json rutea todo al handler, así que sin este guard
// /api-docs entrega el mapa completo de endpoints a cualquiera que lo pida.
if (process.env.NODE_ENV !== 'production') {
  app.use('/api-docs', swaggerUi.serve);
  app.get('/api-docs', swaggerUi.setup(specs, swaggerUiOptions));

  app.get('/api-docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(specs);
  });
}

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

  // En los 5xx el mensaje que sale es GENÉRICO. El de un error inesperado es texto técnico y
  // el cliente no tiene por qué verlo: en producción, un login con el email como objeto
  // respondía 500 con "email?.toLowerCase is not a function". El schema Zod tapa ese caso
  // puntual, pero la fuga era del handler y valía para cualquier error que ningún schema
  // cubriera. El detalle real queda en el log y en Sentry, que es donde sirve.
  //
  // Los 4xx SÍ devuelven su mensaje: son los httpError() de negocio, escritos para que los lea
  // el operario. Por eso primero hubo que pasar a 4xx los ~19 `new Error` de negocio de los
  // servicios ("Cubierta no encontrada", "No se detectaron cambios"), que caían en el 500 por
  // descarte: además de quedar mudos con este cambio, hacían que un id inexistente figurara
  // como falla del servidor y disparara alerta en Sentry.
  res.status(status).json({
    message: status >= 500 ? 'Error interno del servidor. Volvé a intentar en unos minutos.' : err.message || 'Error interno',
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
