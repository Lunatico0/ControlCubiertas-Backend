// Este archivo debe estar en la carpeta api/ en la raíz de tu proyecto
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
app.use(cors({
  origin: ['http://localhost:3000', 'https://controlcubiertas-backend.vercel.app'],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Swagger UI con CDN
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
    html {
      box-sizing: border-box;
      overflow: -moz-scrollbars-vertical;
      overflow-y: scroll;
    }
    *, *:before, *:after {
      box-sizing: inherit;
    }
    body {
      margin: 0;
      background: #fafafa;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .swagger-ui .topbar {
      display: none !important;
    }
    .swagger-ui .info {
      margin: 50px 0;
    }
    .loading {
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      font-size: 18px;
      color: #666;
    }
    .error {
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      font-size: 18px;
      color: #d32f2f;
      flex-direction: column;
      text-align: center;
      padding: 20px;
    }
  </style>
</head>
<body>
  <div id="swagger-ui">
    <div class="loading">Cargando documentación de la API...</div>
  </div>

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
        console.log('🔄 Cargando Swagger UI...');

        await loadScript('https://cdn.jsdelivr.net/npm/swagger-ui-dist@4.15.5/swagger-ui-bundle.js');
        await loadScript('https://cdn.jsdelivr.net/npm/swagger-ui-dist@4.15.5/swagger-ui-standalone-preset.js');

        console.log('✅ Scripts de Swagger UI cargados');

        if (typeof SwaggerUIBundle === 'undefined') {
          throw new Error('SwaggerUIBundle no se pudo cargar correctamente');
        }

        const spec = ${JSON.stringify(specs, null, 2)};

        console.log('📋 Spec cargado:', spec.info.title);

        const ui = SwaggerUIBundle({
          spec: spec,
          dom_id: '#swagger-ui',
          deepLinking: true,
          presets: [
            SwaggerUIBundle.presets.apis,
            SwaggerUIStandalonePreset
          ],
          plugins: [
            SwaggerUIBundle.plugins.DownloadUrl
          ],
          layout: "StandaloneLayout",
          persistAuthorization: true,
          displayRequestDuration: true,
          docExpansion: 'none',
          filter: true,
          showExtensions: true,
          showCommonExtensions: true,
          tryItOutEnabled: true,
          supportedSubmitMethods: ['get', 'post', 'put', 'delete', 'patch'],
          onComplete: function() {
            console.log('🎉 Swagger UI inicializado completamente');
          },
          onFailure: function(error) {
            console.error('❌ Error en Swagger UI:', error);
            showError('Error al inicializar la interfaz de documentación');
          }
        });

        console.log('✅ Swagger UI configurado correctamente');

      } catch (error) {
        console.error('❌ Error cargando Swagger UI:', error);
        showError(\`Error al cargar la documentación: \${error.message}\`);
      }
    }

    function showError(message) {
      document.getElementById('swagger-ui').innerHTML = \`
        <div class="error">
          <h2>⚠️ Error al cargar la documentación</h2>
          <p>\${message}</p>
          <p>Por favor, recarga la página o contacta al administrador.</p>
          <button onclick="location.reload()" style="
            background: #1976d2;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
            margin-top: 20px;
          ">
            🔄 Recargar página
          </button>
        </div>
      \`;
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initSwagger);
    } else {
      initSwagger();
    }

    window.addEventListener('error', function(event) {
      console.error('Error global:', event.error);
      if (event.filename && event.filename.includes('swagger')) {
        showError('Error al cargar los recursos de Swagger UI');
      }
    });
  </script>
</body>
</html>
    `;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(html);

  } catch (error) {
    console.error('Error generando Swagger HTML:', error);
    res.status(500).json({
      message: 'Error al cargar la documentación',
      error: error.message
    });
  }
});

// Rutas de API
app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(specs);
});

app.get('/swagger.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json(specs);
});

// Rutas principales
app.use('/api/tires', tireRoutes);
app.use('/api/vehicles', vehicleRoutes);

// Ruta de bienvenida
app.get('/', (req, res) => {
  res.json({
    message: 'API de Gestión de Cubiertas',
    version: '1.2.0',
    documentation: '/api-docs',
    swagger_json: '/api-docs.json',
    environment: process.env.NODE_ENV || 'development',
    endpoints: {
      tires: '/api/tires',
      vehicles: '/api/vehicles'
    },
    status: 'online',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: '1.2.0'
  });
});

// Middleware de manejo de errores
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  res.status(500).json({
    message: 'Error interno del servidor',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Error interno',
    timestamp: new Date().toISOString()
  });
});

// Middleware para rutas no encontradas
app.use('*', (req, res) => {
  res.status(404).json({
    message: 'Ruta no encontrada',
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

export default app;
