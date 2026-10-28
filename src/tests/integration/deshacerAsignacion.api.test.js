import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../../app.js';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { initBaseConnection, closeAll, getTenantDb } from '../../db/tenantConnections.js';
import { createTenantAndToken } from '../helpers/tenantAuth.js';
import { updateTireFromState } from '../../utils/utils.js';

// S7 (auditoría 26/10): deshacer una asignación dejaba la cubierta en depósito pero con la
// posición del vehículo ("E1-D" con vehicle null), y reetiquetaba la entrada original.
// N5: deshacer una desasignación volvía a montar la cubierta SIN posición, así que el slot
// figuraba libre y se podía montar otra en el mismo lugar. Si el slot ya está ocupado, el
// deshacer se rechaza ANTES de reservar número y de tocar la entrada original.

let mongod;
let auth;
let db;
let seq = 9900;

const DB_NAME = 'tenant_deshacer_asignacion';

const numeroActual = async () => (await db.ReceiptCounter.findOne({ pointOfSale: 1 }))?.currentNumber ?? 0;

const crearVehiculo = () => db.Vehicle.create({
  brand: 'Scania', mobile: `M${++seq}`, licensePlate: `DA${seq}`, axles: [{ type: 'simple' }],
});

// Por la API: así la cubierta tiene su entrada de Alta, como cualquier cubierta real.
const crearCubierta = async () => {
  const res = await request(app).post('/api/tires').set(auth).send({
    status: 'Nueva', code: ++seq, brand: 'B', pattern: 'P', size: '295/80', serialNumber: `SN${seq}`, orderNumber: '2026-000299' });
  expect(res.status).toBe(201);
  return res.body;
};

const montar = async (tire, veh, position, kmAlta = 1000) => {
  const res = await request(app).patch(`/api/tires/${tire._id}/assign`).set(auth)
    .send({ vehicle: String(veh._id), kmAlta, position, orderNumber: '2026-000300' });
  expect(res.status).toBe(200);
};

const desmontar = async (tire, kmBaja = 5000) => {
  const res = await request(app).patch(`/api/tires/${tire._id}/unassign`).set(auth)
    .send({ kmBaja, orderNumber: '2026-000301' });
  expect(res.status).toBe(200);
};

const deshacer = (tire, entrada, extra = {}) => request(app)
  .post(`/api/tires/${tire._id}/history/${entrada._id}/undo`).set(auth)
  .send({ orderNumber: '2026-000302', ...extra });

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await connectControlPlane(uri);
  initBaseConnection(uri);
  await getControlModels().User.init();
  ({ auth } = await createTenantAndToken({ name: 'Deshacer asignacion', dbName: DB_NAME }));
  db = getTenantDb(DB_NAME).models;
});

afterAll(async () => {
  await closeControlPlane();
  await closeAll();
  await mongod.stop();
});

describe('updateTireFromState y la posición', () => {
  it('sin vehículo, la cubierta no conserva posición', () => {
    const tire = { vehicle: 'v1', position: 'E1-D', status: 'Nueva', kilometers: 0 };
    updateTireFromState(tire, { currentVehicle: null, currentStatus: 'Nueva', totalKilometers: 0 });
    expect(tire.position).toBeNull();
  });

  it('si el vehículo cambia, la posición del vehículo anterior no viaja al nuevo', () => {
    const tire = { vehicle: 'v1', position: 'E1-D', status: 'Nueva', kilometers: 0 };
    updateTireFromState(tire, { currentVehicle: 'v2', currentStatus: 'Nueva', totalKilometers: 0 });
    expect(tire.position).toBeNull();
  });

  it('en el mismo vehículo la posición se conserva', () => {
    const tire = { vehicle: { _id: 'v1' }, position: 'E1-D', status: 'Nueva', kilometers: 0 };
    updateTireFromState(tire, { currentVehicle: 'v1', currentStatus: 'Nueva', totalKilometers: 0 });
    expect(tire.position).toBe('E1-D');
  });
});

describe('deshacer una asignación (S7)', () => {
  it('la cubierta queda en depósito sin posición y la original conserva su tipo', async () => {
    const veh = await crearVehiculo();
    const tire = await crearCubierta();
    await montar(tire, veh, 'E1-D');
    const asig = await db.History.findOne({ tire: tire._id, type: 'Asignación' });

    // Sin motivo: los desktops instalados todavía no lo mandan y el backend lo sigue aceptando.
    const res = await deshacer(tire, asig);
    expect(res.status).toBe(200);

    const despues = await db.Tire.findById(tire._id);
    expect(despues.vehicle).toBeNull();
    expect(despues.position).toBeNull();
    const vehDespues = await db.Vehicle.findById(veh._id);
    expect(vehDespues.tires.map(String)).not.toContain(String(tire._id));

    const original = await db.History.findById(asig._id);
    expect(original.type).toBe('Asignación');
    expect(original.flag).toBe(true);
    expect(original.correctedAt).toBeInstanceOf(Date);
    const generada = await db.History.findOne({ corrects: asig._id });
    expect(generada.type).toBe('Desasignación');
  });
});

describe('deshacer una desasignación (N5)', () => {
  it('vuelve a montar la cubierta en la posición que tenía', async () => {
    const veh = await crearVehiculo();
    const tire = await crearCubierta();
    await montar(tire, veh, 'E1-D');
    await desmontar(tire);
    const desas = await db.History.findOne({ tire: tire._id, type: 'Desasignación' });

    const res = await deshacer(tire, desas, { reason: 'Se desmontó por error' });
    expect(res.status).toBe(200);

    const despues = await db.Tire.findById(tire._id);
    expect(String(despues.vehicle)).toBe(String(veh._id));
    expect(despues.position).toBe('E1-D');
    const generada = await db.History.findOne({ corrects: desas._id });
    expect(generada.type).toBe('Asignación');
    expect(generada.position).toBe('E1-D');
    const original = await db.History.findById(desas._id);
    expect(original.type).toBe('Desasignación');
  });

  it('si otra cubierta ya ocupa esa posición: 409, sin número consumido y sin tocar el historial', async () => {
    const veh = await crearVehiculo();
    const tire = await crearCubierta();
    const otra = await crearCubierta();
    await montar(tire, veh, 'E1-D');
    await desmontar(tire);
    await montar(otra, veh, 'E1-D');
    const desas = await db.History.findOne({ tire: tire._id, type: 'Desasignación' });

    const antes = await numeroActual();
    const entradasAntes = await db.History.countDocuments({});

    const res = await deshacer(tire, desas);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/E1-D/);

    expect(await numeroActual()).toBe(antes);
    expect(await db.History.countDocuments({})).toBe(entradasAntes);
    const original = await db.History.findById(desas._id);
    expect(original.type).toBe('Desasignación');
    expect(original.flag).toBe(false);
    expect(original.reason).toBeUndefined();
    expect((await db.Tire.findById(tire._id)).vehicle).toBeNull();
  });
});
