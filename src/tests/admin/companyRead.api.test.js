import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../../app.js';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { initBaseConnection, closeAll } from '../../db/tenantConnections.js';
import { createTenantAndToken } from '../helpers/tenantAuth.js';

// GET /api/company: lectura de datos de empresa + receiptDesign para CUALQUIER rol
// (un operador necesita el diseño del comprobante para imprimir; PATCH sigue siendo admin-only).
let mongod;
let authOperator;

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await connectControlPlane(uri);
  initBaseConnection(uri);
  await getControlModels().User.init();

  const { tenant, auth } = await createTenantAndToken({ name: 'Acme', dbName: 'tenant_companyread', role: 'operator' });
  authOperator = auth;
  await getControlModels().Tenant.findByIdAndUpdate(tenant._id, {
    cuit: '30-12345678-9', phone: '+54 351 555', address: 'Ruta 9 Km 42', receiptFooter: 'Pie del comprobante',
    receiptDesign: { accent: '#2358C5', duplicado: false, logo: 'data:image/png;base64,AAA' },
    plateSeparator: '-', tireCodePrefix: 'TMBC-',
  });
});

afterAll(async () => {
  await closeControlPlane();
  await closeAll();
  await mongod.stop();
});

describe('GET /api/company — empresa + receiptDesign para impresión', () => {
  it('un OPERADOR (no admin) puede leer datos de empresa + receiptDesign', async () => {
    const res = await request(app).get('/api/company').set(authOperator);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Acme');
    expect(res.body.cuit).toBe('30-12345678-9');
    expect(res.body.phone).toBe('+54 351 555');
    expect(res.body.address).toBe('Ruta 9 Km 42');
    expect(res.body.receiptFooter).toBe('Pie del comprobante');
    expect(res.body.receiptDesign.accent).toBe('#2358C5');
    expect(res.body.receiptDesign.duplicado).toBe(false);
  });

  it('incluye plateSeparator y tireCodePrefix (la operativa los necesita para máscara/código)', async () => {
    const res = await request(app).get('/api/company').set(authOperator);
    expect(res.status).toBe(200);
    expect(res.body.plateSeparator).toBe('-');
    expect(res.body.tireCodePrefix).toBe('TMBC-');
  });

  it('sin token → 401', async () => {
    const res = await request(app).get('/api/company');
    expect(res.status).toBe(401);
  });
});
