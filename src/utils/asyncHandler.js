// Envuelve un handler async: cualquier throw/rechazo se deriva a next(err) → el middleware
// de errores central de app.js lo serializa con su status (error.status || 500). Elimina el
// try/catch + console.error + res.status().json() repetido en los controllers.
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
