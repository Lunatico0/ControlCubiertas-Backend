import express from 'express';
import { connectMongo } from './db.js';
import { connectControlPlane } from './db/controlPlane.js';
import cors from 'cors';
import { config } from 'dotenv';
import { requestLogger, errorLogger } from './middleware/logging.middleware.js';
import { setupGlobalErrorHandlers } from './utils/error-handler.js';
import { specs } from '../swagger-setup.js';
import logger from './config/logger.js';

import { attachDb } from './middleware/attachDb.js';
import authRoutes from './routes/auth.routes.js';
import tireRoutes from './routes/tire.routes.js';
import vehicleRoutes from './routes/vehicle.routes.js';
import orderRoutes from './routes/order.routes.js';

config();

const app = express();
setupGlobalErrorHandlers();

// Logging
app.use(requestLogger);

// CORS
app.use(cors());
app.options('*', cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Swagger UI vía CDN (usado por Vercel)
app.get('/api-docs', (req, res) => {
  try {
    const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>API Gestión de Cubiertas - Documentación</title>
      <link rel="stylesheet" type="text/css" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@4.15.5/swagger-ui.css" />
      <style>
        .swagger-ui .topbar { display: none !important; }
        body { margin: 0; background: #fafafa; }
      </style>
    </head>
    <body>
      <div id="swagger-ui"></div>
      <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@4.15.5/swagger-ui-bundle.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@4.15.5/swagger-ui-standalone-preset.js"></script>
      <script>
        window.onload = () => {
          SwaggerUIBundle({
            url: '/api-docs.json',
            dom_id: '#swagger-ui',
            deepLinking: true,
            presets: [
              SwaggerUIBundle.presets.apis,
              SwaggerUIStandalonePreset
            ],
            layout: "StandaloneLayout",
            persistAuthorization: true,
            displayRequestDuration: true,
            docExpansion: 'none',
            filter: true
          });
        };
      </script>
    </body>
    </html>
    `;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    res.status(500).json({ message: 'Error al cargar la documentación' });
  }
});

app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(specs);
});

// Auth (control plane) — va ANTES de attachDb (no opera sobre la DB del tenant).
app.use('/api/auth', authRoutes);

// Inyecta req.db (modelos). Transición mono-tenant; ver middleware/attachDb.js.
app.use(attachDb);

// Rutas principales
app.use('/api/tires', tireRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/orders', orderRoutes);

// Rutas base
app.get('/', (req, res) => {
  res.json({
    message: 'API de Gestión de Cubiertas',
    version: '1.2.0',
    documentation: '/api-docs',
    endpoints: { tires: '/api/tires', vehicles: '/api/vehicles' },
    status: 'online',
    cors: 'enabled'
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    cors: 'enabled'
  });
});

// Logs de errores + manejo
app.use(errorLogger);

app.use((err, req, res, next) => {
  logger.error('Error interno', { message: err.message, stack: err.stack });
  res.status(500).json({ message: 'Error interno del servidor' });
});

app.use('*', (req, res) => {
  logger.warn('Ruta no encontrada', { path: req.originalUrl });
  res.status(404).json({ message: 'Ruta no encontrada' });
});

// src/app.js (últimas líneas, solo si ejecutás app.js directamente)
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 4000;

  connectMongo().then(async () => {
    if (process.env.CONTROL_PLANE_URI) {
      try {
        await connectControlPlane();
        console.log('🔐 Control plane (auth) conectado');
      } catch (e) {
        console.error('Control plane no disponible:', e.message);
      }
    } else {
      console.warn('⚠️  CONTROL_PLANE_URI no seteado: las rutas /api/auth no funcionarán.');
    }
    app.listen(PORT, () => {
      console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
      console.log(`📚 Documentación disponible en: http://localhost:${PORT}/api-docs`);
    });
  });
}


export default app;
