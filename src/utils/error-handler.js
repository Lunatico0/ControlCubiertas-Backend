import logger from '../config/logger.js';

// Clase para errores personalizados
export class AppError extends Error {
  constructor(message, statusCode, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';

    Error.captureStackTrace(this, this.constructor);
  }
}

// Función para manejar errores de MongoDB
export const handleMongoError = (error) => {
  if (error.code === 11000) {
    const field = Object.keys(error.keyValue)[0];
    const value = error.keyValue[field];
    return new AppError(`${field} '${value}' ya existe`, 400);
  }

  if (error.name === 'CastError') {
    return new AppError(`ID inválido: ${error.value}`, 400);
  }

  if (error.name === 'ValidationError') {
    const errors = Object.values(error.errors).map(err => err.message);
    return new AppError(`Error de validación: ${errors.join('. ')}`, 400);
  }

  return error;
};

// Wrapper para funciones async
export const catchAsync = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((err) => {
      logger.logBusinessError(req.originalUrl, err, {
        method: req.method,
        params: req.params,
        body: req.body,
        query: req.query
      });
      next(err);
    });
  };
};

// Manejador global de errores no capturados
export const setupGlobalErrorHandlers = () => {
  // Errores no capturados
  process.on('uncaughtException', (err) => {
    logger.error('UNCAUGHT EXCEPTION! 💥 Shutting down...', {
      error: err.message,
      stack: err.stack,
      timestamp: new Date().toISOString()
    });

    process.exit(1);
  });

  // Promesas rechazadas no manejadas
  process.on('unhandledRejection', (err) => {
    logger.error('UNHANDLED REJECTION! 💥 Shutting down...', {
      error: err.message,
      stack: err.stack,
      timestamp: new Date().toISOString()
    });

    // Dar tiempo para que se complete el logging
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  });

  // Señal de terminación
  process.on('SIGTERM', () => {
    logger.info('👋 SIGTERM RECEIVED. Shutting down gracefully');
    process.exit(0);
  });
};
