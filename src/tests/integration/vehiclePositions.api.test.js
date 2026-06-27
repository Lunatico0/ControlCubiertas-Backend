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
  ({ auth } = await createTenantAndToken({ name: 'Acme', dbName: 'tenant_positions' }));
});

afterAll(async () => {
  await closeControlPlane();
  await closeAll();
  await mongod.stop();
});

describe('Vehículo con ejes + GET /api/vehicles/:id/positions', () => {
  it('crea el vehículo con ejes/km, monta una cubierta en una posición y la lista en el esquema', async () => {
    // alta de un camión 4×2 (simple + dual = 6 posiciones)
    const vehRes = await request(app).post('/api/vehicles').set(auth).send({
      brand: 'Scania',
      mobile: 'Movil X',
      licensePlate: 'XAA-100',
      kilometers: 12000,
      axles: [{ type: 'simple' }, { type: 'dual' }],
    });
    expect(vehRes.status).toBe(201);
    expect(vehRes.body.axles).toHaveLength(2);
    expect(vehRes.body.kilometers).toBe(12000);
    const vehId = vehRes.body._id;

    const tireRes = await request(app).post('/api/tires').set(auth).send({
      code: 500, brand: 'B', pattern: 'P', serialNumber: 'SN500', size: 'S', status: 'Nueva',
    });
    expect(tireRes.status).toBe(201);
    const tireId = tireRes.body._id;

    const assignRes = await request(app).patch(`/api/tires/${tireId}/assign`).set(auth).send({
      vehicle: vehId, kmAlta: 12000, position: 'E2-DE',
    });
    expect(assignRes.status).toBe(200);

    const posRes = await request(app).get(`/api/vehicles/${vehId}/positions`).set(auth);
    expect(posRes.status).toBe(200);
    expect(posRes.body.positions).toHaveLength(6);

    const e2de = posRes.body.positions.find((p) => p.code === 'E2-DE');
    expect(e2de.tire).toBeTruthy();
    expect(e2de.tire.code).toBe(500);

    const e1i = posRes.body.positions.find((p) => p.code === 'E1-I');
    expect(e1i.tire).toBeNull();
  });

  it('404 si el vehículo no existe', async () => {
    const res = await request(app).get('/api/vehicles/64b7f000000000000000a000/positions').set(auth);
    expect(res.status).toBe(404);
  });
});
