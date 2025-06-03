import express from 'express';
import cors from 'cors';
import { specs } from '../swagger-setup.js';
import { generateSwaggerHTML } from './docs.js';

// Importar rutas
import tireRoutes from './routes/tire.routes.js';
import vehicleRoutes from './routes/vehicle.routes.js';

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Configuración alternativa de Swagger para Vercel
app.get('/api-docs', (req, res) => {
  const html = generateSwaggerHTML(specs);
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// Resto de tu configuración...
app.use('/api/tires', tireRoutes);
app.use('/api/vehicles', vehicleRoutes);

app.get('/', (req, res) => {
  res.json({
    message: 'API de Gestión de Cubiertas',
    documentation: '/api-docs',
    version: '1.0.0'
  });
});

export default app;
