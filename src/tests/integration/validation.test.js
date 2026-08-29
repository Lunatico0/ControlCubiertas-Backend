import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../../app.js';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { initBaseConnection, closeAll } from '../../db/tenantConnections.js';
import { createTenantAndToken } from '../helpers/tenantAuth.js';

let mongod;
let auth;

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await connectControlPlane(uri);
  initBaseConnection(uri);
  await getControlModels().User.init();
  ({ auth } = await createTenantAndToken({ name: 'Acme', dbName: 'tenant_validation' }));
});

afterAll(async () => {
  await closeControlPlane();
  await closeAll();
  await mongod.stop();
});

describe('Validación de input con Zod', () => {
  it('POST /api/tires sin brand -> 400 con errors', async () => {
    const res = await request(app).post('/api/tires').set(auth).send({
      code: 5, pattern: 'P', serialNumber: 'S5', size: 'S', status: 'Nueva', orderNumber: '2026-000001' });
    expect(res.status).toBe(400);
    expect(res.body.errors).toBeDefined();
  });

  it('POST /api/tires con status no configurado en el tenant -> 400', async () => {
    const res = await request(app).post('/api/tires').set(auth).send({
      code: 6, brand: 'B', pattern: 'P', serialNumber: 'S6', size: 'S', status: 'Inexistente', orderNumber: '2026-000001' });
    expect(res.status).toBe(400);
    // Ya no lo rechaza el enum de Zod, sino la validación dinámica del controller (por tenant)
    expect(res.body.message).toMatch(/no válido/i);
  });

  it('POST /api/vehicles sin mobile -> 400', async () => {
    const res = await request(app).post('/api/vehicles').set(auth).send({
      brand: 'Ford', licensePlate: 'AAA-200',
    });
    expect(res.status).toBe(400);
    expect(res.body.errors).toBeDefined();
  });

  it('POST /api/tires válido sigue creando (201)', async () => {
    const res = await request(app).post('/api/tires').set(auth).send({
      code: 7, brand: 'B', pattern: 'P', serialNumber: 'S7', size: 'S', status: 'Nueva', orderNumber: '2026-000001' });
    expect(res.status).toBe(201);
  });
});
