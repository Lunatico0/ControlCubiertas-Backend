import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  connectControlPlane,
  getControlModels,
  closeControlPlane,
} from '../../db/controlPlane.js';
import {
  hashPassword,
  verifyPassword,
  signAccessToken,
  verifyAccessToken,
  login,
} from '../../services/auth.service.js';

describe('auth.service', () => {
  let mongod;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = 'test-access-secret';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
    mongod = await MongoMemoryServer.create();
    await connectControlPlane(mongod.getUri());
    await getControlModels().User.init();
  });

  afterAll(async () => {
    await closeControlPlane();
    await mongod.stop();
  });

  it('hashea y verifica password', async () => {
    const hash = await hashPassword('secreto');
    expect(hash).not.toBe('secreto');
    expect(await verifyPassword('secreto', hash)).toBe(true);
    expect(await verifyPassword('incorrecta', hash)).toBe(false);
  });

  it('firma y verifica un access token con sus claims', () => {
    const token = signAccessToken({ userId: 'u1', tenantId: 't1', dbName: 'db1', role: 'tenant-admin' });
    const decoded = verifyAccessToken(token);
    expect(decoded.userId).toBe('u1');
    expect(decoded.dbName).toBe('db1');
    expect(decoded.role).toBe('tenant-admin');
  });

  it('login válido devuelve tokens con los claims del tenant', async () => {
    const { User, Tenant } = getControlModels();
    const t = await Tenant.create({ name: 'Acme', dbName: 'tenant_acme_auth' });
    await User.create({
      email: 'admin@acme.com',
      passwordHash: await hashPassword('pass123'),
      tenantId: t._id,
      role: 'tenant-admin',
    });

    const result = await login(getControlModels(), 'admin@acme.com', 'pass123');
    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();

    const decoded = verifyAccessToken(result.accessToken);
    expect(decoded.dbName).toBe('tenant_acme_auth');
    expect(decoded.role).toBe('tenant-admin');
    expect(decoded.tenantId).toBe(t._id.toString());
    expect(result.user.email).toBe('admin@acme.com');
  });

  it('login con password incorrecta lanza', async () => {
    const { User, Tenant } = getControlModels();
    const t = await Tenant.create({ name: 'B', dbName: 'tenant_b_auth' });
    await User.create({ email: 'b@b.com', passwordHash: await hashPassword('right'), tenantId: t._id });
    await expect(login(getControlModels(), 'b@b.com', 'wrong')).rejects.toThrow();
  });

  it('login con tenant suspendido lanza', async () => {
    const { User, Tenant } = getControlModels();
    const t = await Tenant.create({ name: 'C', dbName: 'tenant_c_auth', status: 'suspended' });
    await User.create({ email: 'c@c.com', passwordHash: await hashPassword('p'), tenantId: t._id });
    await expect(login(getControlModels(), 'c@c.com', 'p')).rejects.toThrow();
  });
});
