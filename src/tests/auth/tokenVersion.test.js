import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import {
  hashPassword,
  login,
  refresh,
  changePassword,
  signRefreshToken,
} from '../../services/auth.service.js';
import { resetPassword } from '../../services/userAdmin.service.js';

// El caso de uso canónico del cambio de contraseña es "me robaron la sesión": si el refresh
// token viejo sigue emitiendo access tokens, el atacante conserva el acceso durante los 7 días
// de vida del refresh. tokenVersion corta esa cadena — se incrementa en cada cambio de
// contraseña y se compara en refresh().
describe('invalidación de refresh tokens por cambio de contraseña', () => {
  let mongod;
  let tenant;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = 'test-access-secret';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
    mongod = await MongoMemoryServer.create();
    await connectControlPlane(mongod.getUri());
    const { Tenant, User } = getControlModels();
    await User.init();
    tenant = await Tenant.create({ name: 'TV', dbName: 'tenant_tv' });
  });

  afterAll(async () => {
    await closeControlPlane();
    await mongod.stop();
  });

  const crearUsuario = async (email, password, extra = {}) => {
    const { User } = getControlModels();
    return User.create({
      email,
      passwordHash: await hashPassword(password),
      tenantId: tenant._id,
      role: 'operator',
      ...extra,
    });
  };

  it('el refresh token sigue sirviendo mientras no cambie la contraseña', async () => {
    await crearUsuario('estable@tv.com', 'pass123');
    const { refreshToken } = await login(getControlModels(), 'estable@tv.com', 'pass123');

    const { accessToken } = await refresh(getControlModels(), refreshToken);
    expect(accessToken).toBeDefined();
  });

  it('changePassword invalida el refresh token emitido antes del cambio', async () => {
    const user = await crearUsuario('victima@tv.com', 'vieja123');
    const { refreshToken } = await login(getControlModels(), 'victima@tv.com', 'vieja123');

    // El refresh robado funciona ANTES del cambio.
    await expect(refresh(getControlModels(), refreshToken)).resolves.toBeDefined();

    await changePassword(getControlModels(), user._id.toString(), 'vieja123', 'nueva456');

    // Y deja de funcionar DESPUÉS.
    await expect(refresh(getControlModels(), refreshToken)).rejects.toThrow();
  });

  it('tras cambiar la contraseña, el refresh del nuevo login sí funciona', async () => {
    const user = await crearUsuario('relogin@tv.com', 'vieja123');
    await changePassword(getControlModels(), user._id.toString(), 'vieja123', 'nueva456');

    const { refreshToken } = await login(getControlModels(), 'relogin@tv.com', 'nueva456');
    await expect(refresh(getControlModels(), refreshToken)).resolves.toBeDefined();
  });

  it('el changePassword de primer ingreso también invalida los refresh vivos', async () => {
    const user = await crearUsuario('primer@tv.com', 'temporal1', { mustChangePassword: true });
    const { refreshToken } = await login(getControlModels(), 'primer@tv.com', 'temporal1');

    await changePassword(getControlModels(), user._id.toString(), null, 'definitiva1');

    await expect(refresh(getControlModels(), refreshToken)).rejects.toThrow();
  });

  it('el resetPassword del admin invalida los refresh vivos del usuario', async () => {
    const user = await crearUsuario('reseteado@tv.com', 'pass123');
    const { refreshToken } = await login(getControlModels(), 'reseteado@tv.com', 'pass123');

    await resetPassword(tenant._id, user._id);

    await expect(refresh(getControlModels(), refreshToken)).rejects.toThrow();
  });

  it('changePassword devuelve tokens nuevos para la sesión que hizo el cambio', async () => {
    // Sin esto, el usuario que cambia su propia contraseña se queda con un refresh inválido
    // y la app lo desloguea sola en cuanto vence el access token (15m).
    const user = await crearUsuario('sigue@tv.com', 'vieja123');
    const { refreshToken: viejo } = await login(getControlModels(), 'sigue@tv.com', 'vieja123');

    const tokens = await changePassword(getControlModels(), user._id.toString(), 'vieja123', 'nueva456');

    expect(tokens.accessToken).toBeDefined();
    expect(tokens.refreshToken).toBeDefined();
    // El token devuelto sirve; el que tenía antes del cambio, no.
    await expect(refresh(getControlModels(), tokens.refreshToken)).resolves.toBeDefined();
    await expect(refresh(getControlModels(), viejo)).rejects.toThrow();
  });

  it('un refresh token viejo sin tokenVersion sigue valiendo si nunca hubo cambio de contraseña', async () => {
    // Compatibilidad con los tokens ya emitidos al momento del deploy: sin este trato,
    // publicar el fix desloguearía a todos los usuarios con sesión abierta.
    const user = await crearUsuario('legado@tv.com', 'pass123');
    const tokenViejo = signRefreshToken({ userId: user._id.toString() });

    await expect(refresh(getControlModels(), tokenViejo)).resolves.toBeDefined();
  });

  it('un refresh token viejo sin tokenVersion deja de valer tras un cambio de contraseña', async () => {
    const user = await crearUsuario('legado2@tv.com', 'pass123');
    const tokenViejo = signRefreshToken({ userId: user._id.toString() });

    await changePassword(getControlModels(), user._id.toString(), 'pass123', 'nueva456');

    await expect(refresh(getControlModels(), tokenViejo)).rejects.toThrow();
  });
});
