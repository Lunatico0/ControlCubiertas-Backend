import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { specs, swaggerUi, swaggerUiOptions } from '../swagger-setup.js';
import { attachDb } from './middleware/attachDb.js';
import tireRoutes from './routes/tire.routes.js';
import vehicleRoutes from './routes/vehicle.routes.js';
import orderRoutes from './routes/order.routes.js';

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

// Inyecta req.db (modelos). Transición mono-tenant; ver middleware/attachDb.js.
app.use(attachDb);

// Rutas principales
app.use('/api/tires', tireRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/orders', orderRoutes);

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

// Middleware de manejo de errores
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  res.status(500).json({
    message: 'Error interno del servidor',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
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
// listen), para poder importarlo en tests con supertest. El arranque real (conectar +
// listen) vive en app.logged.js (local) y api/index.js (serverless).
export default app;
