import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../../app.js';
import {
  connectControlPlane,
  getControlModels,
  closeControlPlane,
} from '../../db/controlPlane.js';
import { hashPassword } from '../../services/auth.service.js';

describe('POST /api/auth/login', () => {
  let mongod;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = 'test-access-secret';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
    mongod = await MongoMemoryServer.create();
    await connectControlPlane(mongod.getUri());
    const { User, Tenant } = getControlModels();
    await User.init();
    const t = await Tenant.create({ name: 'Acme', dbName: 'tenant_acme_login' });
    await User.create({
      email: 'admin@acme.com',
      passwordHash: await hashPassword('pass123'),
      tenantId: t._id,
      role: 'tenant-admin',
    });
  });

  afterAll(async () => {
    await closeControlPlane();
    await mongod.stop();
  });

  it('200 con credenciales válidas y devuelve accessToken', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@acme.com', password: 'pass123' });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.user.role).toBe('tenant-admin');
  });

  it('401 con password incorrecta', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@acme.com', password: 'wrong' });

    expect(res.status).toBe(401);
  });
});
