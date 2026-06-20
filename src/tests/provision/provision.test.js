import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { initBaseConnection, getTenantDb, closeAll } from '../../db/tenantConnections.js';
import { provisionTenant } from '../../services/provision.service.js';
import { login } from '../../services/auth.service.js';

describe('provisionTenant', () => {
  let mongod;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = 'test-access-secret';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    await connectControlPlane(uri);
    initBaseConnection(uri);
    await getControlModels().User.init();
  });

  afterAll(async () => {
    await closeControlPlane();
    await closeAll();
    await mongod.stop();
  });

  it('crea tenant + admin, deriva el dbName y siembra la DB del tenant', async () => {
    const r = await provisionTenant({
      name: 'Cliente Uno',
      adminEmail: 'admin@uno.com',
      password: 'temp123',
    });

    expect(r.dbName).toBe('tenant_cliente_uno');
    expect(r.tenant.status).toBe('active');
    expect(r.user.role).toBe('tenant-admin');

    // el admin puede loguearse (auth end-to-end)
    const loginRes = await login(getControlModels(), 'admin@uno.com', 'temp123');
    expect(loginRes.accessToken).toBeDefined();
    expect(loginRes.user.tenantId.toString()).toBe(r.tenant._id.toString());

    // la DB del tenant quedó sembrada con el contador de recibos
    const { models } = getTenantDb(r.dbName);
    expect(await models.ReceiptCounter.countDocuments()).toBe(1);
  });

  it('rechaza un tenant o email duplicado', async () => {
    await provisionTenant({ name: 'Dup Co', adminEmail: 'a@dup.com', password: 'x' });
    // mismo nombre
    await expect(provisionTenant({ name: 'Dup Co', adminEmail: 'b@dup.com' })).rejects.toThrow();
    // mismo email
    await expect(provisionTenant({ name: 'Otra Co', adminEmail: 'a@dup.com' })).rejects.toThrow();
  });
});
