import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../../app.js';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { initBaseConnection, closeAll } from '../../db/tenantConnections.js';
import { createTenantAndToken } from '../helpers/tenantAuth.js';

// PATCH /api/admin/company pasa por validate(updateCompanySchema). Zod strippea las claves NO
// declaradas en el schema → si un campo editable falta en el schema, el guardado responde 200
// pero NO persiste (bug silencioso). Este test cubre el flujo HTTP COMPLETO (validator incluido),
// que el test de company.service.test.js NO cubre porque llama al service directo.
let mongod;
let authAdmin;

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await connectControlPlane(uri);
  initBaseConnection(uri);
  await getControlModels().User.init();

  const { auth } = await createTenantAndToken({ name: 'Acme', dbName: 'tenant_companyupdate', role: 'tenant-admin' });
  authAdmin = auth;
});

afterAll(async () => {
  await closeControlPlane();
  await closeAll();
  await mongod.stop();
});

describe('PATCH /api/admin/company — persiste preferencias de display (flujo HTTP con validator)', () => {
  it('persiste plateSeparator y tireCodePrefix (no los strippea el validator)', async () => {
    const patch = await request(app).patch('/api/admin/company').set(authAdmin).send({ plateSeparator: '-', tireCodePrefix: 'AC-' });
    expect(patch.status).toBe(200);
    expect(patch.body.plateSeparator).toBe('-');
    expect(patch.body.tireCodePrefix).toBe('AC-');

    // Persistencia real: una lectura posterior los devuelve.
    const read = await request(app).get('/api/admin/company').set(authAdmin);
    expect(read.body.plateSeparator).toBe('-');
    expect(read.body.tireCodePrefix).toBe('AC-');
  });

  it('rechaza un tireCodePrefix inválido (>10 chars) con 400', async () => {
    const res = await request(app).patch('/api/admin/company').set(authAdmin).send({ tireCodePrefix: 'DEMASIADOLARGO' });
    expect(res.status).toBe(400);
  });

  // A1 (auditoría 26/10): plateFormats faltaba en updateCompanySchema. Zod lo strippeaba, el
  // PATCH respondía 200 con los 4 formatos de siempre y la pantalla decía "actualizados".
  it('persiste plateFormats: con 2 formatos marcados guarda 2', async () => {
    const patch = await request(app).patch('/api/admin/company').set(authAdmin).send({ plateFormats: ['AA000AA', 'AAA000'] });
    expect(patch.status).toBe(200);
    expect(patch.body.plateFormats).toEqual(['AA000AA', 'AAA000']);

    const read = await request(app).get('/api/admin/company').set(authAdmin);
    expect(read.body.plateFormats).toEqual(['AA000AA', 'AAA000']);
  });

  it('persiste la lista vacía de plateFormats (la salida explícita para no validar)', async () => {
    const patch = await request(app).patch('/api/admin/company').set(authAdmin).send({ plateFormats: [] });
    expect(patch.status).toBe(200);
    expect(patch.body.plateFormats).toEqual([]);

    const read = await request(app).get('/api/admin/company').set(authAdmin);
    expect(read.body.plateFormats).toEqual([]);
  });

  it('la operativa (GET /api/company) recibe los formatos guardados', async () => {
    await request(app).patch('/api/admin/company').set(authAdmin).send({ plateFormats: ['AA000AA'] });

    const res = await request(app).get('/api/company').set(authAdmin);
    expect(res.status).toBe(200);
    expect(res.body.plateFormats).toEqual(['AA000AA']);
  });

  // A10 (auditoría 26/10): el panel no necesita ni debe ver datos internos del multi-tenant.
  // Las marcas de demo tienen default (false/null), así que existen en todo tenant.
  it('GET y PATCH no devuelven dbName ni las marcas de demo', async () => {
    const internos = ['dbName', 'isDemoTemplate', 'demoOf', 'demoExpiresAt'];

    const read = await request(app).get('/api/admin/company').set(authAdmin);
    expect(read.status).toBe(200);
    const patch = await request(app).patch('/api/admin/company').set(authAdmin).send({ name: 'Acme' });
    expect(patch.status).toBe(200);

    for (const k of internos) {
      expect(read.body).not.toHaveProperty(k);
      expect(patch.body).not.toHaveProperty(k);
    }
    expect(read.body.name).toBe('Acme');
  });

  // Sin plateFormats en el body (cliente desktop viejo, o el editor de comprobante que manda
  // solo sus campos) la config guardada no se toca.
  it('un PATCH sin plateFormats no pisa los formatos guardados', async () => {
    await request(app).patch('/api/admin/company').set(authAdmin).send({ plateFormats: ['AAA000'] });
    const patch = await request(app).patch('/api/admin/company').set(authAdmin).send({ name: 'Acme SA' });
    expect(patch.status).toBe(200);
    expect(patch.body.plateFormats).toEqual(['AAA000']);
  });
});
