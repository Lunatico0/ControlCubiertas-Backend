import crypto from 'node:crypto';
import { getControlModels } from '../db/controlPlane.js';
import { hashPassword } from './auth.service.js';

// Gestión de usuarios del tenant (control plane). Toda operación está scopeada al
// tenantId del admin autenticado: NUNCA se puede leer ni tocar usuarios de otro tenant.
const PUBLIC = '-passwordHash';

export async function listUsers(tenantId) {
  const { User } = getControlModels();
  return User.find({ tenantId }).select(PUBLIC).sort({ createdAt: 1 });
}

export async function createUser(tenantId, { email, name, role = 'operator' }) {
  const { User } = getControlModels();
  const normalized = email.toLowerCase().trim();
  if (await User.findOne({ email: normalized })) {
    throw new Error('El email ya está registrado');
  }
  const tempPassword = crypto.randomBytes(6).toString('hex');
  const created = await User.create({
    email: normalized,
    name,
    role,
    tenantId,
    passwordHash: await hashPassword(tempPassword),
    mustChangePassword: true,
  });
  const user = await User.findById(created._id).select(PUBLIC);
  return { user, tempPassword };
}

export async function setUserStatus(tenantId, userId, status) {
  const { User } = getControlModels();
  const user = await User.findOne({ _id: userId, tenantId });
  if (!user) throw new Error('Usuario no encontrado');

  // No dejar al tenant sin ningún admin activo.
  if (status === 'inactive' && user.role === 'tenant-admin') {
    const activeAdmins = await User.countDocuments({ tenantId, role: 'tenant-admin', status: 'active' });
    if (activeAdmins <= 1) throw new Error('No se puede desactivar al único administrador activo');
  }

  user.status = status;
  await user.save();
  return User.findById(user._id).select(PUBLIC);
}
