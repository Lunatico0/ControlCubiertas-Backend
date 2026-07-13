import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const ACCESS_TTL = '15m';
const REFRESH_TTL = '7d';
const SALT_ROUNDS = 10;

export const hashPassword = (plain) => bcrypt.hash(plain, SALT_ROUNDS);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

// El access token lleva tenantId + dbName + role firmados, así el middleware resuelve el
// tenant SIN tocar el control plane en cada request. El refresh solo lleva el userId.
export const signAccessToken = (payload) =>
  jwt.sign(payload, process.env.JWT_ACCESS_SECRET, { expiresIn: ACCESS_TTL });

export const signRefreshToken = (payload) =>
  jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: REFRESH_TTL });

export const verifyAccessToken = (token) =>
  jwt.verify(token, process.env.JWT_ACCESS_SECRET);

export const verifyRefreshToken = (token) =>
  jwt.verify(token, process.env.JWT_REFRESH_SECRET);

const INVALID = 'Credenciales inválidas';

export async function login({ User, Tenant }, email, password) {
  const user = await User.findOne({ email: email?.toLowerCase().trim() });
  if (!user || user.status !== 'active') throw new Error(INVALID);

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) throw new Error(INVALID);

  const tenant = await Tenant.findById(user.tenantId);
  if (!tenant || tenant.status !== 'active') throw new Error('Tenant inactivo o inexistente');

  const claims = {
    userId: user._id.toString(),
    tenantId: tenant._id.toString(),
    dbName: tenant.dbName,
    role: user.role,
  };

  return {
    accessToken: signAccessToken(claims),
    refreshToken: signRefreshToken({ userId: claims.userId }),
    user: {
      id: user._id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: tenant._id,
      mustChangePassword: user.mustChangePassword,
    },
  };
}

// Cambio de contraseña. Dos flujos:
//  - PRIMER INGRESO (mustChangePassword): el usuario ya se autenticó con la temporal → no
//    se le re-pide la actual; solo define la nueva.
//  - VOLUNTARIO: exige la contraseña actual y la verifica (seguridad).
export async function changePassword({ User }, userId, currentPassword, newPassword) {
  const user = await User.findById(userId);
  if (!user) throw new Error('Usuario no encontrado');

  if (!user.mustChangePassword) {
    if (!currentPassword) throw new Error('Ingresá tu contraseña actual');
    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) throw new Error('La contraseña actual es incorrecta');
  }

  user.passwordHash = await hashPassword(newPassword);
  user.mustChangePassword = false;
  await user.save();
}

// Refresh: valida el refresh token, recarga user + tenant y emite un nuevo access token
// (los datos del tenant pueden haber cambiado, así que se releen del control plane).
export async function refresh({ User, Tenant }, refreshToken) {
  const { userId } = verifyRefreshToken(refreshToken);
  const user = await User.findById(userId);
  if (!user || user.status !== 'active') throw new Error(INVALID);

  const tenant = await Tenant.findById(user.tenantId);
  if (!tenant || tenant.status !== 'active') throw new Error('Tenant inactivo o inexistente');

  const claims = {
    userId: user._id.toString(),
    tenantId: tenant._id.toString(),
    dbName: tenant.dbName,
    role: user.role,
  };
  return { accessToken: signAccessToken(claims) };
}
