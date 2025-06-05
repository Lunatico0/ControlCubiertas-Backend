import express from 'express';
import cors from 'cors';
import logger from './config/logger.js';
import { requestLogger, errorLogger } from './middleware/logging.middleware.js';
import { setupGlobalErrorHandlers } from './utils/error-handler.js';
import tireRoutes from './routes/tire.routes.js';
import vehicleRoutes from './routes/vehicle.routes.js';
import orderRoutes from './routes/order.routes.js';

const app = express();

// Configurar manejadores globales de errores
setupGlobalErrorHandlers();

// Middleware de logging (debe ir antes que otros middlewares)
app.use(requestLogger);

// CORS
app.use(cors());

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Log de inicio de aplicación
logger.info('Application starting', {
  nodeEnv: process.env.NODE_ENV,
  port: process.env.PORT || 8080,
  timestamp: new Date().toISOString()
});

// Rutas
app.use('/api/tires', tireRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/orders', orderRoutes);

// Ruta de health check
app.get('/health', (req, res) => {
  logger.info('Health check requested');
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Middleware de manejo de errores (debe ir al final)
app.use(errorLogger);

// 404 handler
app.use('*', (req, res) => {
  logger.warn('Route not found', {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip
  });

  res.status(404).json({
    success: false,
    message: 'Ruta no encontrada'
  });
});

export default app;
