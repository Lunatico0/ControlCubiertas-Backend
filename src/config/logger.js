import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Crear directorio de logs si no existe
const logsDir = path.join(__dirname, '../../logs');

// Configuración de colores para consola
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

winston.addColors(colors);

// Formato personalizado para logs
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.colorize({ all: true }),
  winston.format.printf((info) => {
    if (info.stack) {
      return `${info.timestamp} ${info.level}: ${info.message}\n${info.stack}`;
    }
    return `${info.timestamp} ${info.level}: ${info.message}`;
  })
);

// Formato para archivos (sin colores)
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Configuración de transports
const transports = [
  // Console transport (solo en desarrollo)
  new winston.transports.Console({
    format: logFormat,
    level: process.env.NODE_ENV === 'production' ? 'warn' : 'debug'
  }),

  // Archivo para todos los logs
  new DailyRotateFile({
    filename: path.join(logsDir, 'application-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '14d',
    format: fileFormat,
    level: 'info'
  }),

  // Archivo solo para errores
  new DailyRotateFile({
    filename: path.join(logsDir, 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '30d',
    format: fileFormat,
    level: 'error'
  }),

  // Archivo para requests HTTP
  new DailyRotateFile({
    filename: path.join(logsDir, 'requests-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '7d',
    format: fileFormat,
    level: 'http'
  })
];

// Crear logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: fileFormat,
  transports,
  // No salir en errores no capturados
  exitOnError: false,
});

// Función para logging de requests HTTP
logger.logRequest = (req, res, responseTime) => {
  const logData = {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent'),
    statusCode: res.statusCode,
    responseTime: `${responseTime}ms`,
    timestamp: new Date().toISOString()
  };

  if (res.statusCode >= 400) {
    logger.error('HTTP Request Error', logData);
  } else {
    logger.http('HTTP Request', logData);
  }
};

// Función para logging de operaciones de base de datos
logger.logDB = (operation, collection, data = {}) => {
  logger.info('Database Operation', {
    operation,
    collection,
    data: typeof data === 'object' ? JSON.stringify(data) : data,
    timestamp: new Date().toISOString()
  });
};

// Función para logging de operaciones críticas
logger.logCritical = (operation, details, userId = null) => {
  logger.warn('Critical Operation', {
    operation,
    details,
    userId,
    timestamp: new Date().toISOString()
  });
};

// Función para logging de errores de negocio
logger.logBusinessError = (operation, error, context = {}) => {
  logger.error('Business Logic Error', {
    operation,
    error: error.message,
    stack: error.stack,
    context,
    timestamp: new Date().toISOString()
  });
};

export default logger;
