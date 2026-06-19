import { getTenantDb } from '../db/tenantConnections.js';

// Resuelve la conexión del TENANT (a partir del JWT) y expone sus modelos en req.db.
// DB-per-tenant real: cada request opera sobre la DB del tenant del token.
// Debe montarse DESPUÉS de authenticate (necesita req.auth.dbName).
export function attachDb(req, res, next) {
  const dbName = req.auth?.dbName;
  if (!dbName) {
    return res.status(401).json({ message: 'No autenticado' });
  }
  try {
    req.db = getTenantDb(dbName).models;
    next();
  } catch (err) {
    return res.status(503).json({ message: 'Base del tenant no disponible', error: err.message });
  }
}
