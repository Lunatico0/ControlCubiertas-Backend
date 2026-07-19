import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../../app.js';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { hashPassword } from '../../services/auth.service.js';
import { createTenantAndToken } from '../helpers/tenantAuth.js';

// PATCH /api/admin/users/:id — edición de usuario (name + role) por el tenant-admin.
// El email NO se edita (es el identificador). Guard anti-lockout: un admin no puede
// quitarse a sí mismo el rol tenant-admin. Todo scopeado al tenant del admin.
let mongod;
let adminAuth;
let adminUser;
let operator;

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  mongod = await MongoMemoryServer.create();
  await connectControlPlane(mongod.getUri());
  await getControlModels().User.init();

  const { tenant, user, auth } = await createTenantAndToken({ name: 'Acme', dbName: 'tenant_updateuser' });
  adminAuth = auth;
  adminUser = user;
  operator = await getControlModels().User.create({
    email: 'op@acme.com',
    passwordHash: await hashPassword('x'),
    tenantId: tenant._id,
    role: 'operator',
    name: 'Operario Viejo',
  });
});

afterAll(async () => {
  await closeControlPlane();
  await mongod.stop();
});

describe('PATCH /api/admin/users/:id — edición de usuario', () => {
  it('el admin edita name + role de otro usuario → 200 y refleja los cambios (sin filtrar hash, email intacto)', async () => {
    const res = await request(app)
      .patch(`/api/admin/users/${operator._id}`)
      .set(adminAuth)
      .send({ name: 'Operario Nuevo', role: 'tenant-admin' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Operario Nuevo');
    expect(res.body.role).toBe('tenant-admin');
    expect(res.body.email).toBe('op@acme.com'); // el email es el identificador, no cambia
    expect(res.body.passwordHash).toBeUndefined();
  });

  it('guard anti-lockout: el admin NO puede quitarse a sí mismo el rol tenant-admin → 400', async () => {
    const res = await request(app)
      .patch(`/api/admin/users/${adminUser._id}`)
      .set(adminAuth)
      .send({ role: 'operator' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/administrador|admin/i);
  });
});
