import { getControlModels } from '../../db/controlPlane.js';
import { hashPassword, signAccessToken } from '../../services/auth.service.js';

// Crea un tenant + usuario en el control plane y devuelve un access token válido
// (con dbName en los claims) para usar en requests de test.
export async function createTenantAndToken({
  name,
  dbName,
  email = `${dbName}@test.com`,
  password = 'pass',
  role = 'tenant-admin',
}) {
  const { User, Tenant } = getControlModels();
  const tenant = await Tenant.create({ name, dbName });
  const user = await User.create({
    email,
    passwordHash: await hashPassword(password),
    tenantId: tenant._id,
    role,
  });
  const token = signAccessToken({
    userId: user._id.toString(),
    tenantId: tenant._id.toString(),
    dbName: tenant.dbName,
    role,
  });
  return { tenant, user, token, auth: { Authorization: `Bearer ${token}` } };
}
