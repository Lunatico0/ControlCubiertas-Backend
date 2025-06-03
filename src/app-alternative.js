import express from 'express';
import './db.js'; // ✅ Importante: conexión a la base de datos
import cors from 'cors';
import { config } from 'dotenv';
import { specs } from '../swagger-setup.js';
import { generateSwaggerHTML } from './docs.js';

// Importar rutas
import tireRoutes from './routes/tire.routes.js';
import vehicleRoutes from './routes/vehicle.routes.js';

config();

const app = express();
const PORT = process.env.PORT || 4000;

// Middlewares
app.use(cors({
  origin: ['http://localhost:3000', 'https://controlcubiertas-backend.vercel.app'],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Configuración alternativa de Swagger para Vercel usando CDN
app.get('/api-docs', (req, res) => {
  try {
    const html = generateSwaggerHTML(specs);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    console.error('Error generando Swagger HTML:', error);
    res.status(500).json({ message: 'Error al cargar la documentación' });
  }
});

// Ruta para obtener el JSON de Swagger
app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(specs);
});

// Ruta para servir la documentación como JSON plano (útil para debugging)
app.get('/swagger.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json(specs);
});

// ✅ Rutas principales
app.use('/api/tires', tireRoutes);
app.use('/api/vehicles', vehicleRoutes);

// ✅ Ruta de bienvenida con información de la API
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
    status: 'online'
  });
});

// ✅ Ruta de health check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// ✅ Middleware de manejo de errores
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  res.status(500).json({
    message: 'Error interno del servidor',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ✅ Middleware para rutas no encontradas
app.use('*', (req, res) => {
  res.status(404).json({
    message: 'Ruta no encontrada',
    path: req.originalUrl,
    method: req.method
  });
});

// Solo iniciar el servidor si no estamos en Vercel
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`📚 Documentación disponible en: http://localhost:${PORT}/api-docs`);
  });
}

export default app;
