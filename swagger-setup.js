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
        Tire: {
          type: 'object',
          required: ['status', 'code', 'brand', 'pattern', 'serialNumber'],
          properties: {
            _id: {
              type: 'string',
              description: 'ID único de la cubierta'
            },
            status: {
              type: 'string',
              enum: ['Nueva', '1er Recapado', '2do Recapado', '3er Recapado', 'A recapar', 'Descartada'],
              description: 'Estado actual de la cubierta'
            },
            code: {
              type: 'number',
              description: 'Código único de la cubierta'
            },
            brand: {
              type: 'string',
              description: 'Marca de la cubierta'
            },
            pattern: {
              type: 'string',
              description: 'Patrón de la cubierta'
            },
            serialNumber: {
              type: 'string',
              description: 'Número de serie de la cubierta'
            },
            kilometers: {
              type: 'number',
              default: 0,
              description: 'Kilómetros recorridos por la cubierta'
            },
            vehicle: {
              type: 'string',
              description: 'ID del vehículo asignado (si aplica)'
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              description: 'Fecha de creación'
            },
            updatedAt: {
              type: 'string',
              format: 'date-time',
              description: 'Fecha de última actualización'
            }
          }
        },
        Vehicle: {
          type: 'object',
          required: ['brand', 'mobile', 'licensePlate'],
          properties: {
            _id: {
              type: 'string',
              description: 'ID único del vehículo'
            },
            brand: {
              type: 'string',
              description: 'Marca del vehículo'
            },
            mobile: {
              type: 'string',
              description: 'Número de móvil único'
            },
            licensePlate: {
              type: 'string',
              description: 'Patente del vehículo'
            },
            type: {
              type: 'string',
              description: 'Tipo de vehículo'
            },
            tires: {
              type: 'array',
              items: {
                type: 'string'
              },
              description: 'Array de IDs de cubiertas asignadas'
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              description: 'Fecha de creación'
            },
            updatedAt: {
              type: 'string',
              format: 'date-time',
              description: 'Fecha de última actualización'
            }
          }
        },
        History: {
          type: 'object',
          properties: {
            _id: {
              type: 'string',
              description: 'ID único de la entrada de historial'
            },
            tire: {
              type: 'string',
              description: 'ID de la cubierta'
            },
            date: {
              type: 'string',
              format: 'date-time',
              description: 'Fecha del evento'
            },
            kmAlta: {
              type: 'number',
              description: 'Kilómetros de alta'
            },
            kmBaja: {
              type: 'number',
              description: 'Kilómetros de baja'
            },
            km: {
              type: 'number',
              description: 'Kilómetros recorridos'
            },
            status: {
              type: 'string',
              description: 'Estado de la cubierta en este momento'
            },
            vehicle: {
              type: 'string',
              description: 'ID del vehículo (si aplica)'
            },
            type: {
              type: 'string',
              enum: ['alta', 'asignacion', 'desasignacion', 'estado', 'correccion-alta', 'correccion-asignacion', 'correccion-desasignacion', 'correccion-estado', 'correccion-otro'],
              description: 'Tipo de evento'
            },
            orderNumber: {
              type: 'string',
              description: 'Número de orden'
            },
            editedFields: {
              type: 'array',
              items: {
                type: 'string'
              },
              description: 'Campos editados (para correcciones)'
            },
            reason: {
              type: 'string',
              description: 'Razón del cambio'
            },
            flag: {
              type: 'boolean',
              default: false,
              description: 'Marca si la entrada fue corregida'
            },
            corrects: {
              type: 'string',
              description: 'ID de la entrada que corrige'
            }
          }
        },
        Error: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'Mensaje de error'
            }
          }
        },
        ReceiptNumber: {
          type: 'object',
          properties: {
            receiptNumber: {
              type: 'string',
              description: 'Número de recibo generado',
              example: '0001-00000001'
            }
          }
        }
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
