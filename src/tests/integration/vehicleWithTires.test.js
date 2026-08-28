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
  ({ auth } = await createTenantAndToken({ name: 'Acme', dbName: 'tenant_vehtires' }));
});

afterAll(async () => {
  await closeControlPlane();
  await closeAll();
  await mongod.stop();
});

describe('Crear vehículo asignando cubiertas (Bug 5)', () => {
  it('crea el vehículo, asigna la cubierta y registra historial de Asignación', async () => {
    const tireRes = await request(app).post('/api/tires').set(auth).send({
      code: 10, brand: 'B', pattern: 'P', serialNumber: 'SN10', size: 'S', status: 'Nueva', orderNumber: '2026-000001' });
    expect(tireRes.status).toBe(201);
    const tireId = tireRes.body._id;

    const vehRes = await request(app).post('/api/vehicles').set(auth).send({
      brand: 'Ford', mobile: 'Movil 10', licensePlate: 'AAA-100', tires: [tireId], orderNumber: '2026-000001' });
    expect(vehRes.status).toBe(201);
    const vehId = vehRes.body._id;

    // la cubierta quedó asignada al vehículo
    const detail = await request(app).get(`/api/tires/${tireId}`).set(auth);
    expect(detail.status).toBe(200);
    const vehicleRef = detail.body.vehicle?._id || detail.body.vehicle;
    expect(String(vehicleRef)).toBe(vehId);

    // se registró el historial (Alta + Asignación), en la colección History
    const types = detail.body.history.map((h) => h.type);
    expect(types).toContain('Asignación');
  });
});
