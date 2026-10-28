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
    plateFormats: ['AA000AA'],
    autoPrint: false,
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

  // t2/t125: la operativa necesita saber si este tenant imprime automáticamente al ejecutar
  // una acción. Sin este campo en la respuesta el frontend no puede respetar la preferencia.
  it('incluye autoPrint (la operativa decide si dispara la impresión automática)', async () => {
    const res = await request(app).get('/api/company').set(authOperator);
    expect(res.status).toBe(200);
    expect(res.body.autoPrint).toBe(false);
  });

  // A1 (auditoría 26/10): sin este campo la operativa nunca recibía los formatos y su
  // validación de patente quedaba apagada siempre (apiContext caía a la lista vacía).
  it('incluye plateFormats (la operativa valida la patente antes de mandarla)', async () => {
    const res = await request(app).get('/api/company').set(authOperator);
    expect(res.status).toBe(200);
    expect(res.body.plateFormats).toEqual(['AA000AA']);
  });

  // Un tenant viejo al que nunca se le escribió el campo cae al default argentino, igual que
  // la validación del backend (getTenantPlateFormats). Hoy lo resuelve el default del schema
  // de Mongoose al hidratar; este test es la red si alguien cambia eso.
  it('tenant sin plateFormats guardado: devuelve el default argentino', async () => {
    const { auth } = await createTenantAndToken({ name: 'Viejo', dbName: 'tenant_companyread_viejo', role: 'operator' });
    await getControlModels().Tenant.collection.updateOne({ name: 'Viejo' }, { $unset: { plateFormats: '' } });

    const res = await request(app).get('/api/company').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.plateFormats).toEqual(['AAA000', 'AA000AA', 'A000AAA', '000AAA']);
  });

  // A10: la operativa no necesita ni debe ver datos internos del multi-tenant.
  it('no devuelve dbName ni las marcas de demo', async () => {
    const res = await request(app).get('/api/company').set(authOperator);
    expect(res.status).toBe(200);
    for (const k of ['dbName', 'isDemoTemplate', 'demoOf', 'demoExpiresAt']) {
      expect(res.body).not.toHaveProperty(k);
    }
  });

  it('sin token → 401', async () => {
    const res = await request(app).get('/api/company');
    expect(res.status).toBe(401);
  });
});
