import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { config } from 'dotenv';

config();

const PORT = process.env.PORT || 4000;

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Sistema de Gestión de Cubiertas',
      version: '1.2.0',
      description: 'API para la gestión de cubiertas y vehículos de transporte',
      contact: {
        name: 'Patricio Pittana',
        email: 'pittanapatricio@gmail.com'
      }
    },
    servers: [
      {
        url: `http://localhost:${PORT}`,
        description: 'Servidor de desarrollo'
      },
      {
        url: 'https://controlcubiertas-backend.vercel.app',
        description: 'Servidor de producción'
      }
    ],
    components: {
      schemas: {
        // ... mantener todos los esquemas como están
        Tire: {
          type: 'object',
          required: ['status', 'code', 'brand', 'pattern', 'serialNumber'],
          properties: {
            _id: { type: 'string', description: 'ID único de la cubierta' },
            status: {
              type: 'string',
              enum: ['Nueva', '1er Recapado', '2do Recapado', '3er Recapado', 'A recapar', 'Descartada'],
              description: 'Estado actual de la cubierta'
            },
            code: { type: 'number', description: 'Código único de la cubierta' },
            brand: { type: 'string', description: 'Marca de la cubierta' },
            pattern: { type: 'string', description: 'Patrón de la cubierta' },
            serialNumber: { type: 'string', description: 'Número de serie de la cubierta' },
            kilometers: { type: 'number', default: 0, description: 'Kilómetros recorridos' },
            vehicle: { type: 'string', description: 'ID del vehículo asignado' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        // ... resto de esquemas
      }
    }
  },
  apis: ['./src/routes/*.js'],
};

const specs = swaggerJsdoc(swaggerOptions);

const swaggerUiOptions = {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: "API Gestión de Cubiertas",
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    docExpansion: 'none',
    filter: true
  }
};

export { specs, swaggerUi, swaggerUiOptions };
