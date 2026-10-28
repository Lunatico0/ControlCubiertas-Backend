import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../../app.js';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { initBaseConnection, closeAll } from '../../db/tenantConnections.js';
import { hashPassword, verifyAccessToken } from '../../services/auth.service.js';
import { provisionTenant } from '../../services/provision.service.js';

// S2 (auditoría 26/10): con mustChangePassword el bloqueo vivía SOLO en el front. El token de
// la clave temporal daba 200 en toda la API, y el cambio aceptaba la temporal como "nueva".
// Ahora el access token lleva el claim `mcp` y requireActiveTenant (por donde pasan tires,
// vehicles, orders, company y admin) responde 403 PASSWORD_CHANGE_REQUIRED hasta el cambio.

let mongod;

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await connectControlPlane(uri);
  initBaseConnection(uri);

  const { User, Tenant } = getControlModels();
  await User.init();
  const t = await Tenant.create({ name: 'Temporal SA', dbName: 'tenant_mcp' });
  await User.create({
    email: 'nuevo@mcp.com',
    name: 'Nora Nueva',
    passwordHash: await hashPassword('temp123'),
    tenantId: t._id,
    role: 'tenant-admin',
    mustChangePassword: true,
  });
  await User.create({
    email: 'viejo@mcp.com',
    passwordHash: await hashPassword('propia123'),
    tenantId: t._id,
    role: 'tenant-admin',
  });
});

afterAll(async () => {
  await closeControlPlane();
  await closeAll();
  await mongod.stop();
});

const login = (email, password) => request(app).post('/api/auth/login').send({ email, password });
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

describe('S2 · el token de una clave temporal no opera hasta cambiarla', () => {
  it('el access token del primer ingreso lleva el claim mcp', async () => {
    const res = await login('nuevo@mcp.com', 'temp123');
    expect(res.status).toBe(200);
    expect(verifyAccessToken(res.body.accessToken).mcp).toBe(true);
  });

  it('el token de un usuario sin cambio pendiente NO lleva mcp', async () => {
    const res = await login('viejo@mcp.com', 'propia123');
    expect(verifyAccessToken(res.body.accessToken).mcp).toBeUndefined();
  });

  it.each([
    ['/api/tires'],
    ['/api/vehicles'],
    ['/api/company'],
    ['/api/admin/users'],
  ])('GET %s con el token de la temporal → 403 PASSWORD_CHANGE_REQUIRED con mensaje legible', async (ruta) => {
    const { accessToken } = (await login('nuevo@mcp.com', 'temp123')).body;
    const res = await request(app).get(ruta).set(bearer(accessToken));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    // Los desktop viejos no conocen el code: el mensaje tiene que explicarse solo.
    expect(res.body.message).toMatch(/contraseña/i);
  });

  it('el refresh de una sesión con cambio pendiente sigue emitiendo mcp', async () => {
    const { refreshToken } = (await login('nuevo@mcp.com', 'temp123')).body;
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(res.status).toBe(200);
    expect(verifyAccessToken(res.body.accessToken).mcp).toBe(true);
  });

  it('un usuario sin cambio pendiente opera normal (control)', async () => {
    const { accessToken } = (await login('viejo@mcp.com', 'propia123')).body;
    const res = await request(app).get('/api/tires').set(bearer(accessToken));
    expect(res.status).toBe(200);
  });

  it('change-password rechaza la MISMA temporal como nueva (400) y el flag sigue en pie', async () => {
    const { accessToken } = (await login('nuevo@mcp.com', 'temp123')).body;
    const res = await request(app).post('/api/auth/change-password').set(bearer(accessToken)).send({ newPassword: 'temp123' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/distinta/i);

    const { User } = getControlModels();
    expect((await User.findOne({ email: 'nuevo@mcp.com' })).mustChangePassword).toBe(true);
  });

  it('el cambio voluntario también rechaza repetir la actual', async () => {
    const { accessToken } = (await login('viejo@mcp.com', 'propia123')).body;
    const res = await request(app).post('/api/auth/change-password').set(bearer(accessToken))
      .send({ currentPassword: 'propia123', newPassword: 'propia123' });
    expect(res.status).toBe(400);
  });

  it('tras cambiarla, el token nuevo opera y ya no lleva mcp (ni tampoco el del refresh)', async () => {
    const { accessToken } = (await login('nuevo@mcp.com', 'temp123')).body;
    const chg = await request(app).post('/api/auth/change-password').set(bearer(accessToken)).send({ newPassword: 'definitiva9' });
    expect(chg.status).toBe(200);
    expect(verifyAccessToken(chg.body.accessToken).mcp).toBeUndefined();

    const tires = await request(app).get('/api/tires').set(bearer(chg.body.accessToken));
    expect(tires.status).toBe(200);

    const ref = await request(app).post('/api/auth/refresh').send({ refreshToken: chg.body.refreshToken });
    expect(verifyAccessToken(ref.body.accessToken).mcp).toBeUndefined();
  });
});

describe('prep A2 · el access token lleva el nombre del usuario', () => {
  it('claim name = nombre del usuario', async () => {
    const res = await login('nuevo@mcp.com', 'definitiva9');
    expect(verifyAccessToken(res.body.accessToken).name).toBe('Nora Nueva');
  });

  it('sin nombre cargado, el claim name cae al email', async () => {
    const res = await login('viejo@mcp.com', 'propia123');
    expect(verifyAccessToken(res.body.accessToken).name).toBe('viejo@mcp.com');
  });
});

describe('la demo no queda gateada', () => {
  it('la plantilla aprovisionada como la siembra seed-demo-realista entra y opera', async () => {
    const prov = await provisionTenant({
      name: 'Andes Cargo Gate',
      adminEmail: 'admin@andesgate.com',
      password: 'AndesAdmin25',
      mustChangePassword: false,
    });
    prov.tenant.isDemoTemplate = true;
    await prov.tenant.save();

    const res = await login('admin@andesgate.com', 'AndesAdmin25');
    expect(res.status).toBe(200);
    expect(res.body.user.mustChangePassword).toBe(false);
    const claims = verifyAccessToken(res.body.accessToken);
    expect(claims.mcp).toBeUndefined();
    expect(claims.dbName).toMatch(/^tenant_demo_/); // sesión contra el clon, no la plantilla

    const vehiculos = await request(app).get('/api/vehicles').set(bearer(res.body.accessToken));
    expect(vehiculos.status).toBe(200);
  });
});
