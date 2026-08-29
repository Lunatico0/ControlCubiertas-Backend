import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../../app.js';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { initBaseConnection, closeAll, getTenantDb } from '../../db/tenantConnections.js';
import { hashPassword, verifyAccessToken } from '../../services/auth.service.js';
import { VENTANA_DEMO_MS } from '../../services/demo.service.js';

// El enganche del demo en el flujo de auth. Es la parte delicada, por dos razones:
//
// 1. `refresh` re-derivaba el tenant desde `user.tenantId`. Para un visitante de la demo eso
//    sería devolverlo a la PLANTILLA en cuanto se le vence el access token de 15 minutos: se
//    quedaría sin sus datos a mitad de la prueba, y peor, escribiendo en la base compartida.
//    El tenant efímero tiene que viajar en el refresh token.
//
// 2. La purga borra bases enteras. Un token de un demo ya vencido no puede seguir operando
//    aunque criptográficamente siga siendo válido.
//
// El usuario demo NO se clona: su email es único en el control plane, así que sigue siendo el
// mismo `admin@andescargo.com` de siempre. Lo que cambia es contra QUÉ tenant se firma.

const DB_PLANTILLA = 'tenant_andescargo_login';
let mongod;
let plantillaId;

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await connectControlPlane(uri);
  initBaseConnection(uri);

  const { Tenant, User } = getControlModels();
  await User.init();

  const plantilla = await Tenant.create({ name: 'Andes Cargo', dbName: DB_PLANTILLA, isDemoTemplate: true });
  plantillaId = plantilla._id;
  await User.create({
    email: 'admin@andescargo.com',
    passwordHash: await hashPassword('tireops'),
    tenantId: plantilla._id,
    role: 'tenant-admin',
  });

  // Un cliente REAL, para probar que su login no cambia en nada.
  const real = await Tenant.create({ name: 'Cliente Real', dbName: 'tenant_real_login' });
  await User.create({
    email: 'admin@real.com',
    passwordHash: await hashPassword('secreto123'),
    tenantId: real._id,
    role: 'tenant-admin',
  });

  const { models } = getTenantDb(DB_PLANTILLA);
  await models.Vehicle.create({ brand: 'Scania', mobile: 'AC-01', licensePlate: 'AAA111', axles: [], tires: [] });
});

afterAll(async () => {
  await closeControlPlane();
  await closeAll();
  await mongod.stop();
});

const loginDemo = () => request(app).post('/api/auth/login').send({ email: 'admin@andescargo.com', password: 'tireops' });
const claims = (token) => verifyAccessToken(token);

describe('login demo · cada visitante entra a su propio tenant', () => {
  it('el token NO apunta a la base de la plantilla', async () => {
    const res = await loginDemo();

    expect(res.status).toBe(200);
    expect(claims(res.body.accessToken).dbName).not.toBe(DB_PLANTILLA);
    expect(claims(res.body.accessToken).dbName).toMatch(/^tenant_demo_/);
  });

  it('dos visitantes reciben DOS tenants distintos', async () => {
    const uno = await loginDemo();
    const dos = await loginDemo();

    expect(claims(uno.body.accessToken).dbName).not.toBe(claims(dos.body.accessToken).dbName);
  });

  it('el visitante ve los datos sembrados de Andes Cargo, no una base vacía', async () => {
    const res = await loginDemo();

    const vehiculos = await request(app).get('/api/vehicles')
      .set('Authorization', `Bearer ${res.body.accessToken}`);

    expect(vehiculos.status).toBe(200);
    expect(vehiculos.body).toHaveLength(1);
    expect(vehiculos.body[0].mobile).toBe('AC-01');
  });

  it('lo que carga el visitante NO llega a la plantilla', async () => {
    const res = await loginDemo();

    await request(app).post('/api/vehicles').set('Authorization', `Bearer ${res.body.accessToken}`)
      .send({ brand: 'X', mobile: 'NUEVO', licensePlate: 'ZZZ999', axles: [{ type: 'simple' }] });

    const { models } = getTenantDb(DB_PLANTILLA);
    expect(await models.Vehicle.countDocuments()).toBe(1);
  });

  it('el tenant efímero nace con su vencimiento a 48 hs', async () => {
    const antes = Date.now();
    const res = await loginDemo();

    const { Tenant } = getControlModels();
    const demo = await Tenant.findById(claims(res.body.accessToken).tenantId);

    expect(String(demo.demoOf)).toBe(String(plantillaId));
    expect(demo.demoExpiresAt.getTime() - antes).toBeGreaterThan(VENTANA_DEMO_MS - 5000);
  });
});

describe('refresh · la sesión demo no vuelve a la plantilla al vencer el access token', () => {
  it('el token refrescado sigue apuntando al MISMO tenant efímero', async () => {
    const login = await loginDemo();
    const dbDemo = claims(login.body.accessToken).dbName;

    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: login.body.refreshToken });

    expect(res.status).toBe(200);
    expect(claims(res.body.accessToken).dbName).toBe(dbDemo);
  });

  it('los datos del visitante siguen ahí después de refrescar', async () => {
    const login = await loginDemo();
    await request(app).post('/api/vehicles').set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ brand: 'X', mobile: 'PERSISTE', licensePlate: 'PPP111', axles: [{ type: 'simple' }] });

    const refrescado = await request(app).post('/api/auth/refresh').send({ refreshToken: login.body.refreshToken });
    const vehiculos = await request(app).get('/api/vehicles')
      .set('Authorization', `Bearer ${refrescado.body.accessToken}`);

    expect(vehiculos.body.map((v) => v.mobile)).toContain('PERSISTE');
  });

  it('un demo VENCIDO no puede refrescar, aunque el token siga siendo válido', async () => {
    const login = await loginDemo();
    const { Tenant } = getControlModels();
    await Tenant.findByIdAndUpdate(claims(login.body.accessToken).tenantId, {
      demoExpiresAt: new Date(Date.now() - 1000),
    });

    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: login.body.refreshToken });

    expect(res.status).toBe(401);
  });
});

describe('el cliente que paga no se entera de nada', () => {
  it('su login sigue apuntando a SU base de siempre', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@real.com', password: 'secreto123' });

    expect(res.status).toBe(200);
    expect(claims(res.body.accessToken).dbName).toBe('tenant_real_login');
  });

  it('su refresh tampoco lo manda a ningún lado raro', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: 'admin@real.com', password: 'secreto123' });

    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: login.body.refreshToken });

    expect(claims(res.body.accessToken).dbName).toBe('tenant_real_login');
  });
});
