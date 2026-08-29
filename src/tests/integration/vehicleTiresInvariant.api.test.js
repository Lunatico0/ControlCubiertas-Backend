// Invariante de los DOS lados de la relación cubierta ↔ vehículo.
//
// Mongoose no tiene back-ref automática entre `tire.vehicle` y `vehicle.tires[]`: cada camino
// que asigna, desasigna, reasigna o borra tiene que mantener los dos lados a mano. Cuando uno
// solo se actualiza, quedan refs colgadas en `vehicle.tires[]` — el Bug 3 histórico.
//
// Estos tests fijan la invariante como contrato: para toda cubierta y todo vehículo,
//   tire.vehicle === vehicle._id   ⟺   vehicle.tires incluye tire._id
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import app from '../../app.js';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { initBaseConnection, closeAll, getTenantDb } from '../../db/tenantConnections.js';
import { createTenantAndToken } from '../helpers/tenantAuth.js';

let mongod;
let auth;
const DB_NAME = 'tenant_vehtires_invariant';

const models = () => getTenantDb(DB_NAME).models;

/** Lee `vehicle.tires[]` crudo (sin populate) como lista de strings. */
const tiresOf = async (vehicleId) => {
  const v = await models().Vehicle.findById(vehicleId).lean();
  return (v?.tires || []).map(String);
};

/** Verifica la invariante en las dos direcciones para todo el tenant. */
const checkInvariant = async () => {
  const [vehicles, tires] = await Promise.all([
    models().Vehicle.find({}).lean(),
    models().Tire.find({}).lean(),
  ]);
  const byId = new Map(tires.map((t) => [String(t._id), t]));
  const colgadas = [];
  const faltantes = [];

  for (const v of vehicles) {
    for (const ref of v.tires || []) {
      const t = byId.get(String(ref));
      // ref que apunta a una cubierta inexistente, o a una que ya no dice pertenecer al vehículo
      if (!t || String(t.vehicle || '') !== String(v._id)) {
        colgadas.push({ vehicle: v.mobile, ref: String(ref), motivo: t ? 'la cubierta no apunta al vehículo' : 'la cubierta no existe' });
      }
    }
  }
  for (const t of tires) {
    if (!t.vehicle) continue;
    const v = vehicles.find((x) => String(x._id) === String(t.vehicle));
    if (!v || !(v.tires || []).some((ref) => String(ref) === String(t._id))) {
      faltantes.push({ tire: t.code, vehicle: String(t.vehicle), motivo: 'la cubierta apunta al vehículo pero no está en su array' });
    }
  }
  return { colgadas, faltantes };
};

let codeSeq = 500;
const nuevaCubierta = async () => {
  const code = ++codeSeq;
  const res = await request(app).post('/api/tires').set(auth).send({
    code, brand: 'Bridgestone', pattern: 'Liso', serialNumber: `SN-${code}`, size: '295/80 R22.5', status: 'Nueva', orderNumber: '2026-000001' });
  expect(res.status).toBe(201);
  return res.body._id;
};

let plateSeq = 500;
const nuevoVehiculo = async (tires = []) => {
  const n = ++plateSeq;
  const res = await request(app).post('/api/vehicles').set(auth).send({
    brand: 'Scania', mobile: `Movil ${n}`, licensePlate: `AAA-${n}`, tires, orderNumber: '2026-000001' });
  return res;
};

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await connectControlPlane(uri);
  initBaseConnection(uri);
  await getControlModels().User.init();
  ({ auth } = await createTenantAndToken({ name: 'Invariant SA', dbName: DB_NAME }));
});

afterAll(async () => {
  await closeControlPlane();
  await closeAll();
  await mongod.stop();
});

describe('Invariante vehicle.tires[] ↔ tire.vehicle', () => {
  it('PUT /api/vehicles/:id persiste el array de cubiertas del vehículo', async () => {
    const veh = await nuevoVehiculo();
    expect(veh.status).toBe(201);
    const tireId = await nuevaCubierta();

    const res = await request(app).put(`/api/vehicles/${veh.body._id}`).set(auth).send({ tires: [tireId] });
    expect(res.status).toBe(200);

    // el lado del vehículo tiene que quedar guardado en la DB, no sólo en el documento en memoria
    expect(await tiresOf(veh.body._id)).toEqual([String(tireId)]);
    expect(await checkInvariant()).toEqual({ colgadas: [], faltantes: [] });
  });

  it('PUT /api/vehicles/:id saca del array las cubiertas desvinculadas', async () => {
    const veh = await nuevoVehiculo();
    const a = await nuevaCubierta();
    const b = await nuevaCubierta();

    await request(app).put(`/api/vehicles/${veh.body._id}`).set(auth).send({ tires: [a, b] });
    expect((await tiresOf(veh.body._id)).sort()).toEqual([String(a), String(b)].sort());

    // se queda sólo con `a`: `b` tiene que salir de los DOS lados
    const res = await request(app).put(`/api/vehicles/${veh.body._id}`).set(auth).send({ tires: [a] });
    expect(res.status).toBe(200);
    expect(await tiresOf(veh.body._id)).toEqual([String(a)]);
    expect(await checkInvariant()).toEqual({ colgadas: [], faltantes: [] });
  });

  it('POST /api/vehicles no mete en el array ids de cubiertas inexistentes', async () => {
    const real = await nuevaCubierta();
    const fantasma = new mongoose.Types.ObjectId().toString();

    const res = await nuevoVehiculo([real, fantasma]);
    // o rechaza el alta, o la acepta guardando SOLO las cubiertas que existen
    if (res.status === 201) {
      expect(await tiresOf(res.body._id)).toEqual([String(real)]);
    } else {
      expect(res.status).toBe(400);
    }
    expect(await checkInvariant()).toEqual({ colgadas: [], faltantes: [] });
  });

  it('deshacer una Asignación saca la cubierta del array del vehículo', async () => {
    const veh = await nuevoVehiculo();
    const tireId = await nuevaCubierta();

    const asignar = await request(app).patch(`/api/tires/${tireId}/assign`).set(auth)
      .send({ vehicle: veh.body._id, kmAlta: 1000, orderNumber: '2026-000041' });
    expect(asignar.status).toBe(200);
    expect(await tiresOf(veh.body._id)).toEqual([String(tireId)]);

    const hist = await models().History.find({ tire: tireId, type: 'Asignación' }).lean();
    expect(hist).toHaveLength(1);

    const undo = await request(app).post(`/api/tires/${tireId}/history/${hist[0]._id}/undo`).set(auth)
      .send({ orderNumber: '2026-000042' });
    expect(undo.status).toBe(200);

    // la cubierta ya no pertenece al vehículo: tiene que salir también de su array
    const tire = await models().Tire.findById(tireId).lean();
    expect(tire.vehicle).toBeFalsy();
    expect(await tiresOf(veh.body._id)).toEqual([]);
    expect(await checkInvariant()).toEqual({ colgadas: [], faltantes: [] });
  });

  it('deshacer una Desasignación devuelve la cubierta al array del vehículo', async () => {
    const veh = await nuevoVehiculo();
    const tireId = await nuevaCubierta();

    await request(app).patch(`/api/tires/${tireId}/assign`).set(auth)
      .send({ vehicle: veh.body._id, kmAlta: 1000, orderNumber: '2026-000043' });
    const desasignar = await request(app).patch(`/api/tires/${tireId}/unassign`).set(auth)
      .send({ kmBaja: 2000, orderNumber: '2026-000044' });
    expect(desasignar.status).toBe(200);
    expect(await tiresOf(veh.body._id)).toEqual([]);

    const hist = await models().History.find({ tire: tireId, type: 'Desasignación' }).lean();
    expect(hist).toHaveLength(1);

    const undo = await request(app).post(`/api/tires/${tireId}/history/${hist[0]._id}/undo`).set(auth)
      .send({ orderNumber: '2026-000045' });
    expect(undo.status).toBe(200);

    // vuelve a pertenecer al vehículo: los DOS lados otra vez
    const tire = await models().Tire.findById(tireId).lean();
    expect(String(tire.vehicle)).toBe(String(veh.body._id));
    expect(await tiresOf(veh.body._id)).toEqual([String(tireId)]);
    expect(await checkInvariant()).toEqual({ colgadas: [], faltantes: [] });
  });
});
