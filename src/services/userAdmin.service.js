import crypto from 'node:crypto';
import { getControlModels } from '../db/controlPlane.js';
import { hashPassword } from './auth.service.js';
import { httpError } from '../utils/httpError.js';

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
    throw httpError('El email ya está registrado', 400);
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
  if (!user) throw httpError('Usuario no encontrado', 400);

  // No dejar al tenant sin ningún admin activo.
  if (status === 'inactive' && user.role === 'tenant-admin') {
    const activeAdmins = await User.countDocuments({ tenantId, role: 'tenant-admin', status: 'active' });
    if (activeAdmins <= 1) throw httpError('No se puede desactivar al único administrador activo', 400);
  }

  user.status = status;
  await user.save();
  return User.findById(user._id).select(PUBLIC);
}

// Edición de usuario por el admin: actualiza name y/o role. El email NO se edita (es el
// identificador). Scopeado al tenant. GUARD anti-lockout: un tenant-admin no puede quitarse
// a sí mismo el rol de admin (selfUserId === userId), para no quedar sin acceso al panel.
export async function updateUser(tenantId, selfUserId, userId, { name, role }) {
  const { User } = getControlModels();
  const user = await User.findOne({ _id: userId, tenantId });
  if (!user) throw httpError('Usuario no encontrado', 400);

  if (role && role !== 'tenant-admin' && user.role === 'tenant-admin' && String(userId) === String(selfUserId)) {
    throw httpError('No podés quitarte a vos mismo el rol de administrador', 400);
  }

  if (name !== undefined) user.name = name;
  if (role !== undefined) user.role = role;
  await user.save();
  return User.findById(user._id).select(PUBLIC);
}

// Reset de contraseña por el admin: cuando un operario pierde su password, el admin le
// genera una temporal (misma mecánica que el alta) y fuerza el cambio en el próximo
// ingreso (mustChangePassword=true → RequireAuth manda a /cambiar-password). Scopeado al
// tenant: no se puede resetear un usuario de otra empresa.
export async function resetPassword(tenantId, userId) {
  const { User } = getControlModels();
  const user = await User.findOne({ _id: userId, tenantId });
  if (!user) throw httpError('Usuario no encontrado', 400);

  const tempPassword = crypto.randomBytes(6).toString('hex');
  user.passwordHash = await hashPassword(tempPassword);
  user.mustChangePassword = true;
  await user.save();

  const safe = await User.findById(user._id).select(PUBLIC);
  return { user: safe, tempPassword };
}
