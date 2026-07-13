import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../../app.js';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { hashPassword } from '../../services/auth.service.js';

let mongod;

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
  mongod = await MongoMemoryServer.create();
  await connectControlPlane(mongod.getUri());
  const { User, Tenant } = getControlModels();
  await User.init();
  const t = await Tenant.create({ name: 'Acme', dbName: 'tenant_pass' });
  await User.create({
    email: 'admin@pass.com',
    passwordHash: await hashPassword('temp123'),
    tenantId: t._id,
    role: 'tenant-admin',
    mustChangePassword: true,
  });
});

afterAll(async () => {
  await closeControlPlane();
  await mongod.stop();
});

const login = (password) => request(app).post('/api/auth/login').send({ email: 'admin@pass.com', password });

describe('cambio de contraseña / primer ingreso', () => {
  it('login devuelve mustChangePassword=true para el usuario recién creado', async () => {
    const res = await login('temp123');
    expect(res.status).toBe(200);
    expect(res.body.user.mustChangePassword).toBe(true);
  });

  it('change-password sin token → 401', async () => {
    const res = await request(app).post('/api/auth/change-password').send({ currentPassword: 'temp123', newPassword: 'nueva123' });
    expect(res.status).toBe(401);
  });

  it('cambia la contraseña, baja el flag y permite loguear con la nueva', async () => {
    const token = (await login('temp123')).body.accessToken;
    const chg = await request(app)
      .post('/api/auth/change-password')
      .set({ Authorization: `Bearer ${token}` })
      .send({ currentPassword: 'temp123', newPassword: 'nueva123' });
    expect(chg.status).toBe(200);

    const relogin = await login('nueva123');
    expect(relogin.status).toBe(200);
    expect(relogin.body.user.mustChangePassword).toBe(false);
  });

  it('change-password con la contraseña actual incorrecta → 400', async () => {
    const token = (await login('nueva123')).body.accessToken;
    const chg = await request(app)
      .post('/api/auth/change-password')
      .set({ Authorization: `Bearer ${token}` })
      .send({ currentPassword: 'esta-no-es', newPassword: 'otra123' });
    expect(chg.status).toBe(400);
  });

  it('en primer ingreso permite cambiar SIN enviar la contraseña actual', async () => {
    const { User, Tenant } = getControlModels();
    const t = await Tenant.findOne({ dbName: 'tenant_pass' });
    await User.create({ email: 'op2@pass.com', passwordHash: await hashPassword('temp999'), tenantId: t._id, role: 'operator', mustChangePassword: true });
    const token = (await request(app).post('/api/auth/login').send({ email: 'op2@pass.com', password: 'temp999' })).body.accessToken;
    const chg = await request(app)
      .post('/api/auth/change-password')
      .set({ Authorization: `Bearer ${token}` })
      .send({ newPassword: 'segura999' }); // sin currentPassword
    expect(chg.status).toBe(200);
    const relogin = await request(app).post('/api/auth/login').send({ email: 'op2@pass.com', password: 'segura999' });
    expect(relogin.body.user.mustChangePassword).toBe(false);
  });

  it('cambio voluntario (sin mustChange) SIN la actual → 400', async () => {
    // op2 ya cambió arriba → mustChangePassword=false; ahora exige la actual.
    const token = (await request(app).post('/api/auth/login').send({ email: 'op2@pass.com', password: 'segura999' })).body.accessToken;
    const chg = await request(app)
      .post('/api/auth/change-password')
      .set({ Authorization: `Bearer ${token}` })
      .send({ newPassword: 'otra-mas' }); // sin currentPassword y ya no es primer ingreso
    expect(chg.status).toBe(400);
  });
});
