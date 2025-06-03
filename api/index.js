import express from 'express';
import '../src/db.js';
import cors from 'cors';
import { config } from 'dotenv';
import { specs } from '../swagger-setup.js';

// Importar rutas
import tireRoutes from '../src/routes/tire.routes.js';
import vehicleRoutes from '../src/routes/vehicle.routes.js';

config();

const app = express();

// Middlewares
// app.use(cors());

app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:8080',
    'https://controlcubiertas-backend.vercel.app',
    'https://control-cubiertas.vercel.app/'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Middleware para manejar preflight requests
app.options('*', cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Swagger UI con CDN (para Vercel)
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
  <script>
    function loadScript(src) {
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.crossOrigin = 'anonymous';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }

    async function initSwagger() {
      try {
        await loadScript('https://cdn.jsdelivr.net/npm/swagger-ui-dist@4.15.5/swagger-ui-bundle.js');
        await loadScript('https://cdn.jsdelivr.net/npm/swagger-ui-dist@4.15.5/swagger-ui-standalone-preset.js');

        SwaggerUIBundle({
          spec: ${JSON.stringify(specs, null, 2)},
          dom_id: '#swagger-ui',
          deepLinking: true,
          presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
          plugins: [SwaggerUIBundle.plugins.DownloadUrl],
          layout: "StandaloneLayout",
          persistAuthorization: true,
          displayRequestDuration: true,
          docExpansion: 'none',
          filter: true
        });
      } catch (error) {
        document.getElementById('swagger-ui').innerHTML = '<div style="text-align:center;padding:50px;">Error cargando documentación</div>';
      }
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initSwagger);
    } else {
      initSwagger();
    }
  </script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    res.status(500).json({ message: 'Error al cargar la documentación' });
  }
});

// Rutas de API
app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(specs);
});

// ✅ Rutas principales (DESPUÉS de CORS)
app.use('/api/tires', tireRoutes);
app.use('/api/vehicles', vehicleRoutes);

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
