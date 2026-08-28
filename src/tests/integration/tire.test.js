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
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await connectControlPlane(uri);
  initBaseConnection(uri);
  await getControlModels().User.init();
  ({ auth } = await createTenantAndToken({ name: 'Acme', dbName: 'tenant_acme_flow' }));
});

afterAll(async () => {
  await closeControlPlane();
  await closeAll();
  await mongod.stop();
});

describe('Flow: Crear, asignar y desasignar cubierta (con auth + tenant)', () => {
  let createdTire;
  let createdVehicle;

  it('rechaza sin token (401)', async () => {
    const res = await request(app).get('/api/tires');
    expect(res.status).toBe(401);
  });

  it('debe crear un vehículo', async () => {
    const res = await request(app).post('/api/vehicles').set(auth).send({
      mobile: 'Movil 99',
      licensePlate: 'ABC-999',
      brand: 'Ford',
      tires: [],
    });

    expect(res.status).toBe(201);
    createdVehicle = res.body;
  });

  it('debe crear una cubierta', async () => {
    const res = await request(app).post('/api/tires').set(auth).send({
      code: 99,
      brand: 'Michelin',
      pattern: 'Liso',
      serialNumber: 'XYZ999',
      size: '11R22.5',
      status: 'Nueva',
      kilometers: 0,
      createdAt: new Date(), orderNumber: '2026-000001' });

    expect(res.status).toBe(201);
    createdTire = res.body;
  });

  it('debe asignar la cubierta', async () => {
    const res = await request(app).patch(`/api/tires/${createdTire._id}/assign`).set(auth).send({
      vehicle: createdVehicle._id,
      kmAlta: 100,
      orderNumber: '000001',
    });

    expect(res.status).toBe(200);
    expect(res.body.tire.vehicle._id).toBe(createdVehicle._id);
  });

  it('debe desasignar la cubierta', async () => {
    const res = await request(app).patch(`/api/tires/${createdTire._id}/unassign`).set(auth).send({
      kmBaja: 150,
      orderNumber: '000002',
    });

    expect(res.status).toBe(200);
    expect(res.body.kmRecorridos).toBe(50);
  });
});
