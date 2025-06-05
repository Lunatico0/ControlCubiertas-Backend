import logger from '../config/logger.js';

// Middleware para logging de requests
export const requestLogger = (req, res, next) => {
  const start = Date.now();

  // Log de request entrante
  logger.info('Incoming Request', {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent'),
    body: req.method !== 'GET' ? req.body : undefined,
    query: Object.keys(req.query).length > 0 ? req.query : undefined
  });

  // Interceptar el final de la response
  const originalSend = res.send;
  res.send = function(data) {
    const responseTime = Date.now() - start;
    logger.logRequest(req, res, responseTime);

    // Si hay error en la response, loggear detalles
    if (res.statusCode >= 400) {
      logger.error('Response Error', {
        method: req.method,
        url: req.originalUrl,
        statusCode: res.statusCode,
        responseData: data,
        responseTime: `${responseTime}ms`
      });
    }

    return originalSend.call(this, data);
  };

  next();
};

// Middleware para capturar errores no manejados
export const errorLogger = (err, req, res, next) => {
  logger.error('Unhandled Error', {
    error: err.message,
    stack: err.stack,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    body: req.body,
    params: req.params,
    query: req.query,
    timestamp: new Date().toISOString()
  });

  // Si es un error de validación o negocio, responder con 400
  if (err.name === 'ValidationError' || err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: 'Error de validación',
      error: err.message
    });
  }

  // Para otros errores, responder con 500
  res.status(500).json({
    success: false,
    message: 'Error interno del servidor',
    error: process.env.NODE_ENV === 'production' ? 'Something went wrong' : err.message
  });
};

// Middleware para logging de operaciones exitosas
export const successLogger = (operation) => {
  return (req, res, next) => {
    const originalSend = res.send;
    res.send = function(data) {
      if (res.statusCode < 400) {
        logger.info(`${operation} Success`, {
          method: req.method,
          url: req.originalUrl,
          statusCode: res.statusCode,
          operation,
          timestamp: new Date().toISOString()
        });
      }
      return originalSend.call(this, data);
    };
    next();
  };
};
