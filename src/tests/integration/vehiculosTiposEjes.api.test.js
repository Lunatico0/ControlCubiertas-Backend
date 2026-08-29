import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../../app.js';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { initBaseConnection, closeAll, getTenantDb } from '../../db/tenantConnections.js';
import { registerModels } from '../../db/registerModels.js';
import { createTenantAndToken } from '../helpers/tenantAuth.js';

// Hito 1 — Vehículos: guard al reconfigurar ejes con cubierta montada (guard duro) +
// tipos de vehículo custom por tenant. Nomenclatura de posiciones = E{n}-{lado}.
const DB = 'tenant_vehtipos';
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

// Camión 4×2: eje 1 simple (E1-I, E1-D) + eje 2 dual (E2-IE, E2-II, E2-DI, E2-DE) = 6 posiciones
const mkVehicle = async (mobile, lp) => {
  const res = await request(app).post('/api/vehicles').set(auth)
    .send({ brand: 'Scania', mobile, licensePlate: lp, axles: [{ type: 'simple' }, { type: 'dual' }] });
  return res.body._id;
};
const mountTire = (vehId, position) => {
  seq += 1;
  return db.Tire.create({
    status: 'Nueva', code: 9000 + seq, brand: 'B', pattern: 'P', size: 'S',
    serialNumber: `SN${9000 + seq}`, vehicle: vehId, position,
  });
};

describe('Guard: reconfigurar ejes con cubierta montada (guard duro)', () => {
  it('409 si el layout nuevo elimina una posición ocupada', async () => {
    const id = await mkVehicle('M-guard1', 'GRD101');
    await mountTire(id, 'E2-DE'); // ocupa el eje 2
    const res = await request(app).patch(`/api/vehicles/${id}/axles`).set(auth)
      .send({ axles: [{ type: 'simple' }] }); // saca el eje 2 → E2-DE desaparece
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/desasign/i);
  });

  it('permite agregar un eje si no se pierde ninguna posición ocupada', async () => {
    const id = await mkVehicle('M-guard2', 'GRD102');
    await mountTire(id, 'E2-DE');
    const res = await request(app).patch(`/api/vehicles/${id}/axles`).set(auth)
      .send({ axles: [{ type: 'simple' }, { type: 'dual' }, { type: 'dual' }] }); // agrega eje 3, mantiene E1/E2
    expect(res.status).toBe(200);
    expect(res.body.axles).toHaveLength(3);
  });

  it('permite reconfigurar libremente si no hay cubiertas montadas', async () => {
    const id = await mkVehicle('M-guard3', 'GRD103');
    const res = await request(app).patch(`/api/vehicles/${id}/axles`).set(auth)
      .send({ axles: [{ type: 'simple' }] });
    expect(res.status).toBe(200);
    expect(res.body.axles).toHaveLength(1);
  });

  it('bloquea reconfigurar si hay una cubierta montada sin posición (modelo viejo)', async () => {
    const id = await mkVehicle('M-guard4', 'GRD104'); // ya tiene ejes
    await mountTire(id, null); // montada sin posición
    const res = await request(app).patch(`/api/vehicles/${id}/axles`).set(auth)
      .send({ axles: [{ type: 'dual' }, { type: 'dual' }] });
    expect(res.status).toBe(409);
  });

  it('permite la PRIMERA configuración (axles vacío) aunque haya cubierta montada sin posición', async () => {
    const veh = await request(app).post('/api/vehicles').set(auth)
      .send({ brand: 'Volvo', mobile: 'M-mig', licensePlate: 'MIG100' }); // sin ejes
    await mountTire(veh.body._id, null); // montada sin posición (legacy)
    const res = await request(app).patch(`/api/vehicles/${veh.body._id}/axles`).set(auth)
      .send({ axles: [{ type: 'simple' }, { type: 'dual' }] });
    expect(res.status).toBe(200);
  });

  it('guarda el type (tipo de vehículo)', async () => {
    const id = await mkVehicle('M-type', 'TYP101');
    const res = await request(app).patch(`/api/vehicles/${id}/axles`).set(auth)
      .send({ axles: [{ type: 'simple' }, { type: 'dual' }], type: 'Camión 4×2' });
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('Camión 4×2');
  });
});

describe('Tipos de vehículo custom (por tenant)', () => {
  it('crea un tipo custom y lo lista', async () => {
    const create = await request(app).post('/api/vehicles/types').set(auth)
      .send({ name: 'Bitrén 7 ejes', axles: ['dual', 'dual', 'dual', 'dual', 'dual', 'dual', 'dual'] });
    expect(create.status).toBe(201);
    expect(create.body.name).toBe('Bitrén 7 ejes');

    const list = await request(app).get('/api/vehicles/types').set(auth);
    expect(list.status).toBe(200);
    expect(list.body.some((t) => t.name === 'Bitrén 7 ejes')).toBe(true);
  });

  it('rechaza nombre duplicado', async () => {
    await request(app).post('/api/vehicles/types').set(auth).send({ name: 'Dup', axles: ['simple'] });
    const dup = await request(app).post('/api/vehicles/types').set(auth).send({ name: 'Dup', axles: ['simple'] });
    expect(dup.status).toBe(409);
  });

  it('rechaza axles inválidos', async () => {
    const res = await request(app).post('/api/vehicles/types').set(auth).send({ name: 'Bad', axles: ['triple'] });
    expect(res.status).toBe(400);
  });
});
