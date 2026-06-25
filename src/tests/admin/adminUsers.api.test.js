import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../../app.js';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { hashPassword, signAccessToken } from '../../services/auth.service.js';

let mongod;
let adminAuth;
let operatorAuth;

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  mongod = await MongoMemoryServer.create();
  await connectControlPlane(mongod.getUri());
  const { User, Tenant } = getControlModels();
  await User.init();
  const tenant = await Tenant.create({ name: 'Acme', dbName: 'tenant_admin_api' });
  const admin = await User.create({ email: 'admin@acme.com', passwordHash: await hashPassword('x'), tenantId: tenant._id, role: 'tenant-admin' });
  const op = await User.create({ email: 'op@acme.com', passwordHash: await hashPassword('x'), tenantId: tenant._id, role: 'operator' });
  const claims = (u) => ({ userId: u._id.toString(), tenantId: tenant._id.toString(), dbName: tenant.dbName, role: u.role });
  adminAuth = { Authorization: `Bearer ${signAccessToken(claims(admin))}` };
  operatorAuth = { Authorization: `Bearer ${signAccessToken(claims(op))}` };
});

afterAll(async () => {
  await closeControlPlane();
  await mongod.stop();
});

describe('/api/admin/users', () => {
  it('sin token → 401', async () => {
    expect((await request(app).get('/api/admin/users')).status).toBe(401);
  });

  it('un operativo → 403', async () => {
    expect((await request(app).get('/api/admin/users').set(operatorAuth)).status).toBe(403);
  });

  it('el admin lista los usuarios del tenant', async () => {
    const res = await request(app).get('/api/admin/users').set(adminAuth);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('el admin crea un usuario y recibe la password temporal', async () => {
    const res = await request(app).post('/api/admin/users').set(adminAuth).send({ email: 'nuevo@acme.com', name: 'Nuevo', role: 'operator' });
    expect(res.status).toBe(201);
    expect(res.body.tempPassword).toBeTruthy();
    expect(res.body.user.role).toBe('operator');
  });

  it('rechaza email inválido (Zod) → 400', async () => {
    const res = await request(app).post('/api/admin/users').set(adminAuth).send({ email: 'no-es-email' });
    expect(res.status).toBe(400);
    expect(res.body.errors).toBeDefined();
  });
});
