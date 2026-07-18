import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../../app.js';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { initBaseConnection, closeAll, getTenantDb } from '../../db/tenantConnections.js';
import { registerModels } from '../../db/registerModels.js';
import { createTenantAndToken } from '../helpers/tenantAuth.js';

// Guard: una cubierta en estado con rol 'recap' ("A recapar") NO se puede asignar a un
// vehículo — hay que recaparla primero. El rol se resuelve de los stockStatuses del tenant
// (el default incluye { name: 'A recapar', role: 'recap' }).
const DB = 'tenant_asignrecap';
let mongod;
let auth;
let db;
let seq = 0;

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await connectControlPlane(uri);
  initBaseConnection(uri);
  await getControlModels().User.init();
  ({ auth } = await createTenantAndToken({ name: 'Acme', dbName: DB }));
  db = registerModels(getTenantDb(DB));
});

afterAll(async () => {
  await closeControlPlane();
  await closeAll();
  await mongod.stop();
});

const mkVehicle = async () => {
  const res = await request(app).post('/api/vehicles').set(auth)
    .send({ brand: 'Scania', mobile: `M-${++seq}`, licensePlate: `P-${seq}`, axles: [{ type: 'simple' }, { type: 'dual' }] });
  return res.body._id;
};
const mkTire = (status) => {
  seq += 1;
  return db.Tire.create({ status, code: 7000 + seq, brand: 'B', pattern: 'P', size: 'S', serialNumber: `SN${7000 + seq}` });
};

describe('PATCH /api/tires/:id/assign — guard de cubierta "A recapar"', () => {
  it('409 al asignar una cubierta en estado con rol recap', async () => {
    const vehId = await mkVehicle();
    const tire = await mkTire('A recapar');
    const res = await request(app).patch(`/api/tires/${tire._id}/assign`).set(auth)
      .send({ vehicle: vehId, kmAlta: 1000, orderNumber: 'ORD-1', receiptNumber: '0001-00000001', position: 'E1-I' });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/recap/i);
  });

  it('permite asignar una cubierta asignable (Nueva)', async () => {
    const vehId = await mkVehicle();
    const tire = await mkTire('Nueva');
    const res = await request(app).patch(`/api/tires/${tire._id}/assign`).set(auth)
      .send({ vehicle: vehId, kmAlta: 1000, orderNumber: 'ORD-2', receiptNumber: '0001-00000002', position: 'E1-I' });
    expect(res.status).toBe(200);
    expect(String(res.body.tire.vehicle?._id || res.body.tire.vehicle)).toBe(String(vehId));
  });
});
