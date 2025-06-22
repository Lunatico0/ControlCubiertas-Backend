import express from 'express';
import '../src/db.js';
import cors from 'cors';
import { config } from 'dotenv';
import { specs } from '../swagger-setup.js';

// Importar rutas
import tireRoutes from '../src/routes/tire.routes.js';
import vehicleRoutes from '../src/routes/vehicle.routes.js';
import orderRoutes from '../src/routes/order.routes.js';

config();

const app = express();

// Middlewares
app.use(cors());
// Middleware para manejar preflight requests
app.options('*', cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rutas de API
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

// ✅ Rutas principales (DESPUÉS de CORS)
app.use('/api/tires', tireRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/orders', orderRoutes);

// Rutas básicas
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

app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(specs);
});

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    cors: 'enabled'
  });
});

// Middleware de errores
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  res.status(500).json({ message: 'Error interno del servidor' });
});

app.use('*', (req, res) => {
  res.status(404).json({ message: 'Ruta no encontrada' });
});

export default app;
