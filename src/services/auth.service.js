import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { httpError } from '../utils/httpError.js';

const ACCESS_TTL = '15m';
const REFRESH_TTL = '7d';
const SALT_ROUNDS = 10;

export const hashPassword = (plain) => bcrypt.hash(plain, SALT_ROUNDS);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

// El access token lleva tenantId + dbName + role firmados, así el middleware resuelve el
// tenant SIN tocar el control plane en cada request. El refresh lleva el userId y el
// tokenVersion con el que se emitió (ver bumpTokenVersion).
export const signAccessToken = (payload) =>
  jwt.sign(payload, process.env.JWT_ACCESS_SECRET, { expiresIn: ACCESS_TTL });

export const signRefreshToken = (payload) =>
  jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: REFRESH_TTL });

export const verifyAccessToken = (token) =>
  jwt.verify(token, process.env.JWT_ACCESS_SECRET);

export const verifyRefreshToken = (token) =>
  jwt.verify(token, process.env.JWT_REFRESH_SECRET);

const INVALID = 'Credenciales inválidas';

// tokenVersion de un usuario ya guardado. Los documentos creados antes de que el campo
// existiera no lo traen: cuentan como 0, igual que los refresh tokens emitidos sin `tv`.
const versionOf = (user) => user.tokenVersion ?? 0;

// Invalida TODOS los refresh tokens vivos del usuario. Se llama en cada cambio de contraseña.
// El access token en curso sobrevive hasta su expiración (15m): es la ventana aceptada a
// cambio de no consultar el control plane en cada request.
export const bumpTokenVersion = (user) => {
  user.tokenVersion = versionOf(user) + 1;
};

// Claims firmados en el access token: tenantId + dbName + role, así el middleware resuelve
// el tenant sin tocar el control plane en cada request. Compartido por login y refresh.
const buildClaims = (user, tenant) => ({
  userId: user._id.toString(),
  tenantId: tenant._id.toString(),
  dbName: tenant.dbName,
  role: user.role,
});

export async function login({ User, Tenant }, email, password) {
  const user = await User.findOne({ email: email?.toLowerCase().trim() });
  if (!user || user.status !== 'active') throw httpError(INVALID, 401);

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) throw httpError(INVALID, 401);

  const tenant = await Tenant.findById(user.tenantId);
  if (!tenant || tenant.status !== 'active') throw httpError('Tenant inactivo o inexistente', 401);

  const claims = buildClaims(user, tenant);

  return {
    accessToken: signAccessToken(claims),
    refreshToken: signRefreshToken({ userId: claims.userId, tv: versionOf(user) }),
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
// Devuelve tokens NUEVOS para la sesión que hizo el cambio: el bump de tokenVersion mata
// todos los refresh vivos, incluido el de quien está cambiando su propia contraseña, y sin
// esto la app lo desloguearía sola al vencer su access token.
export async function changePassword({ User, Tenant }, userId, currentPassword, newPassword) {
  const user = await User.findById(userId);
  if (!user) throw httpError('Usuario no encontrado', 400);

  if (!user.mustChangePassword) {
    if (!currentPassword) throw httpError('Ingresá tu contraseña actual', 400);
    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) throw httpError('La contraseña actual es incorrecta', 400);
  }

  user.passwordHash = await hashPassword(newPassword);
  user.mustChangePassword = false;
  bumpTokenVersion(user); // corta las sesiones abiertas con la contraseña anterior
  await user.save();

  // El tenant se relee DESPUÉS de guardar: si quedó inactivo entremedio, la contraseña ya
  // cambió (es lo que el usuario pidió) y el 401 termina la sesión, que es lo correcto.
  const tenant = await Tenant.findById(user.tenantId);
  if (!tenant || tenant.status !== 'active') throw httpError('Tenant inactivo o inexistente', 401);

  const claims = buildClaims(user, tenant);
  return {
    accessToken: signAccessToken(claims),
    refreshToken: signRefreshToken({ userId: claims.userId, tv: versionOf(user) }),
  };
}

// Refresh: valida el refresh token, recarga user + tenant y emite un nuevo access token
// (los datos del tenant pueden haber cambiado, así que se releen del control plane).
export async function refresh({ User, Tenant }, refreshToken) {
  const { userId, tv } = verifyRefreshToken(refreshToken);
  const user = await User.findById(userId);
  if (!user || user.status !== 'active') throw httpError(INVALID, 401);
  // Un token emitido antes del último cambio de contraseña ya no vale.
  if ((tv ?? 0) !== versionOf(user)) throw httpError(INVALID, 401);

  const tenant = await Tenant.findById(user.tenantId);
  if (!tenant || tenant.status !== 'active') throw httpError('Tenant inactivo o inexistente', 401);

  const claims = buildClaims(user, tenant);
  return { accessToken: signAccessToken(claims) };
}
