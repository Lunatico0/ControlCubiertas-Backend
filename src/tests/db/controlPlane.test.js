import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  connectControlPlane,
  getControlModels,
  closeControlPlane,
} from '../../db/controlPlane.js';

describe('control plane (DB central: User + Tenant)', () => {
  let mongod;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await connectControlPlane(mongod.getUri());
    // asegurar índices (unique) construidos antes de los tests de unicidad
    const { User } = getControlModels();
    await User.init();
  });

  afterAll(async () => {
    await closeControlPlane();
    await mongod.stop();
  });

  it('registra los modelos User y Tenant', () => {
    const m = getControlModels();
    expect(Object.keys(m).sort()).toEqual(['Tenant', 'User']);
  });

  it('crea un tenant y un user con referencia, con defaults', async () => {
    const { User, Tenant } = getControlModels();
    const t = await Tenant.create({ name: 'Acme', dbName: 'tenant_acme' });
    const u = await User.create({
      email: 'Admin@Acme.com',
      passwordHash: 'hash',
      tenantId: t._id,
      role: 'tenant-admin',
    });
    expect(u.email).toBe('admin@acme.com'); // lowercase
    expect(u.status).toBe('active'); // default
    expect(t.status).toBe('active'); // default

    const found = await User.findById(u._id).populate('tenantId');
    expect(found.tenantId.dbName).toBe('tenant_acme');
  });

  it('rechaza email duplicado (unique)', async () => {
    const { User, Tenant } = getControlModels();
    const t = await Tenant.create({ name: 'Globex', dbName: 'tenant_globex' });
    await User.create({ email: 'dup@x.com', passwordHash: 'h', tenantId: t._id });
    await expect(
      User.create({ email: 'dup@x.com', passwordHash: 'h2', tenantId: t._id })
    ).rejects.toThrow();
  });
});
