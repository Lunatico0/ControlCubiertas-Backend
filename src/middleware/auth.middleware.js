import { verifyAccessToken } from '../services/auth.service.js';

// Verifica el Bearer token y deja req.auth = { userId, tenantId, dbName, role }.
// En fase 03, attachDb usará req.auth.dbName para resolver la conexión del tenant.
export function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ message: 'Token de acceso requerido' });
  }

  try {
    req.auth = verifyAccessToken(token);
    next();
  } catch {
    return res.status(401).json({ message: 'Token inválido o expirado' });
  }
}

// RBAC: exige que req.auth.role esté entre los permitidos. Usar después de authenticate.
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      return res.status(403).json({ message: 'No autorizado para esta acción' });
    }
    next();
  };
}
