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
});
