import { verifyAccessToken } from '../services/auth.service.js';
import { getControlModels } from '../db/controlPlane.js';

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

// Valida que el TENANT del JWT siga existiendo y activo en el control plane. Sin esto, un
// usuario cuyo tenant fue eliminado seguiría "navegando" con todo en cero (el JWT lleva el
// dbName, y Mongo recrea la DB vacía al conectar). Devuelve 403 + code TENANT_INACTIVE para que
// el front distinga este caso, avise y cierre sesión (no tiene sentido refrescar el token).
// Usar DESPUÉS de authenticate. Es 1 query por _id (indexado) por request.
export async function requireActiveTenant(req, res, next) {
  try {
    const { Tenant } = getControlModels();
    const tenant = await Tenant.findById(req.auth.tenantId).select('status dbName');
    if (!tenant) {
      return res.status(403).json({ message: 'Tu empresa ya no está disponible. Contactá al administrador.', code: 'TENANT_INACTIVE' });
    }
    if (tenant.status === 'suspended') {
      return res.status(403).json({ message: 'Tu empresa está suspendida. Contactá al administrador.', code: 'TENANT_INACTIVE' });
    }
    // attachDb usa el dbName FIRMADO en el JWT. Si el tenant migró de base (cutover, o un
    // dbName corregido a mano), los tokens vivos seguirían escribiendo en la base vieja hasta
    // que expiren. Contrastarlo acá cuesta cero: es la misma query que ya se hizo.
    if (req.auth.dbName && tenant.dbName && req.auth.dbName !== tenant.dbName) {
      return res.status(403).json({ message: 'Tu sesión ya no es válida. Volvé a iniciar sesión.', code: 'TENANT_INACTIVE' });
    }
    next();
  } catch (err) {
    next(err);
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
