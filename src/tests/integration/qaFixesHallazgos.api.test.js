import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../../app.js';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { initBaseConnection, closeAll, getTenantDb } from '../../db/tenantConnections.js';
import { registerModels } from '../../db/registerModels.js';
import { createTenantAndToken } from '../helpers/tenantAuth.js';

// Hito QA: fixes de hallazgos.
//  #1 — Alta de vehículo con móvil/patente duplicado debe devolver 400 con mensaje AMABLE,
//       sin filtrar el error crudo de Mongo (E11000 / nombre de DB / índice). El path de editar
//       (updateDetails) ya lo hace; el create no.
//  #3 — Errores de validación de negocio en asignar/desasignar deben ser 4xx (no 500).
const DB = 'tenant_qafixes';
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

const mkVehicle = async (mobile, lp, axles = [{ type: 'simple' }, { type: 'dual' }]) => {
  const res = await request(app).post('/api/vehicles').set(auth)
    .send({ brand: 'Scania', mobile, licensePlate: lp, axles });
  return res;
};
const mkTire = (status = 'Nueva') => {
  seq += 1;
  return db.Tire.create({ status, code: 5000 + seq, brand: 'B', pattern: 'P', size: 'S', serialNumber: `SN${5000 + seq}` });
};
const noLeak = (msg) => expect(msg).not.toMatch(/E11000|duplicate key|index:|tenant_/i);

describe('#1 — Alta de vehículo: duplicados con mensaje amable (sin filtrar Mongo)', () => {
  it('400 y mensaje amable al crear con patente duplicada', async () => {
    await mkVehicle('DUP-mob-1', 'DUP-PLATE-1');
    const res = await mkVehicle('DUP-mob-2', 'DUP-PLATE-1');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/patente/i);
    noLeak(res.body.message);
  });

  it('400 y mensaje amable al crear con móvil duplicado', async () => {
    await mkVehicle('DUP-mob-X', 'DUP-PLATE-A');
    const res = await mkVehicle('DUP-mob-X', 'DUP-PLATE-B');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/m[oó]vil/i);
    noLeak(res.body.message);
  });
});

describe('#4 — Patente normalizada (alfanumérica, case-insensitive)', () => {
  it('normaliza a MAYÚSCULAS y sin símbolos al crear', async () => {
    const res = await mkVehicle('NORM-1', 'xyz-999');
    expect(res.status).toBe(201);
    expect(res.body.licensePlate).toBe('XYZ999');
  });

  it('"ABC301" y "ABC-301" son la misma patente → duplicado (400 + field)', async () => {
    const a = await mkVehicle('NORM-2a', 'ABC301');
    expect(a.status).toBe(201);
    const b = await mkVehicle('NORM-2b', 'ABC-301');
    expect(b.status).toBe(400);
    expect(b.body.message).toMatch(/patente/i);
    expect(b.body.field).toBe('licensePlate');
  });

  it('el 400 de móvil duplicado trae field="mobile"', async () => {
    await mkVehicle('NORM-DUPMOB', 'NORMP-1');
    const res = await mkVehicle('NORM-DUPMOB', 'NORMP-2');
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('mobile');
  });
});

describe('#3 — Validaciones de asignar/desasignar devuelven 4xx (no 500)', () => {
  it('409 al asignar a una posición ya ocupada', async () => {
    const veh = await mkVehicle('OCC-1', 'OCC-P1');
    const t1 = await mkTire();
    const a1 = await request(app).patch(`/api/tires/${t1._id}/assign`).set(auth)
      .send({ vehicle: veh.body._id, kmAlta: 1000, orderNumber: 'O1', receiptNumber: '0001-00000001', position: 'E1-I' });
    expect(a1.status).toBe(200);

    const t2 = await mkTire();
    const a2 = await request(app).patch(`/api/tires/${t2._id}/assign`).set(auth)
      .send({ vehicle: veh.body._id, kmAlta: 1000, orderNumber: 'O2', receiptNumber: '0001-00000002', position: 'E1-I' });
    expect(a2.status).toBe(409);
    expect(a2.body.message).toMatch(/ocupad/i);
  });

  it('409 al asignar una cubierta que ya está asignada', async () => {
    const veh = await mkVehicle('OCC-2', 'OCC-P2');
    const t1 = await mkTire();
    await request(app).patch(`/api/tires/${t1._id}/assign`).set(auth)
      .send({ vehicle: veh.body._id, kmAlta: 1000, orderNumber: 'O3', receiptNumber: '0001-00000003', position: 'E1-I' });
    const again = await request(app).patch(`/api/tires/${t1._id}/assign`).set(auth)
      .send({ vehicle: veh.body._id, kmAlta: 1000, orderNumber: 'O4', receiptNumber: '0001-00000004', position: 'E1-D' });
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/ya est[aá] asignada/i);
  });

  it('400 al desasignar con kmBaja < kmAlta', async () => {
    const veh = await mkVehicle('OCC-3', 'OCC-P3');
    const t1 = await mkTire();
    await request(app).patch(`/api/tires/${t1._id}/assign`).set(auth)
      .send({ vehicle: veh.body._id, kmAlta: 1000, orderNumber: 'O5', receiptNumber: '0001-00000005', position: 'E1-I' });
    const res = await request(app).patch(`/api/tires/${t1._id}/unassign`).set(auth)
      .send({ kmBaja: 500, orderNumber: 'O6', receiptNumber: '0001-00000006' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/kilometraje/i);
  });
});
