import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../../app.js';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { initBaseConnection, closeAll, getTenantDb } from '../../db/tenantConnections.js';
import { createTenantAndToken } from '../helpers/tenantAuth.js';

// S6 y N6 (auditoría 26/10) más el contrato del modelo de History que leen las tandas
// siguientes (autoría, comprobante con vehículo previo, timeline de correcciones).
//
// S6: corregir un movimiento comparaba el vehículo POPULADO contra un id, así que el vehículo
// figuraba siempre como "cambiado", y además reetiquetaba la entrada ORIGINAL como
// "Corrección-*": el historial perdía qué había sido el movimiento corregido.
// N6: corregir el vehículo de una asignación dejaba el código de posición del vehículo viejo
// sobre el nuevo.

let mongod;
let auth;
let db;
let seq = 9600;

const DB_NAME = 'tenant_correccion_historial';

const crearVehiculo = () => db.Vehicle.create({
  brand: 'Scania', mobile: `M${++seq}`, licensePlate: `CH${seq}`, axles: [{ type: 'simple' }, { type: 'dual' }],
});

// Por la API: así la cubierta tiene su entrada de Alta, como cualquier cubierta real.
const crearCubierta = async () => {
  const res = await request(app).post('/api/tires').set(auth).send({
    status: 'Nueva', code: ++seq, brand: 'B', pattern: 'P', size: '295/80', serialNumber: `SN${seq}`, orderNumber: '2026-000199' });
  expect(res.status).toBe(201);
  return res.body;
};

const montar = async (tire, veh, position = 'E1-I', kmAlta = 1000) => {
  const res = await request(app).patch(`/api/tires/${tire._id}/assign`).set(auth)
    .send({ vehicle: String(veh._id), kmAlta, position, orderNumber: '2026-000200' });
  expect(res.status).toBe(200);
  return db.History.findOne({ tire: tire._id, type: 'Asignación' });
};

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await connectControlPlane(uri);
  initBaseConnection(uri);
  await getControlModels().User.init();
  ({ auth } = await createTenantAndToken({ name: 'Correccion historial', dbName: DB_NAME }));
  db = getTenantDb(DB_NAME).models;
});

afterAll(async () => {
  await closeControlPlane();
  await closeAll();
  await mongod.stop();
});

describe('modelo de History: campos que leen las tandas siguientes', () => {
  it('persiste user {id, name}, fromVehicle y correctedAt', async () => {
    const tire = await crearCubierta();
    const veh = await crearVehiculo();
    const cuando = new Date(2026, 9, 1);
    const creada = await db.History.create({
      tire: tire._id, type: 'Desasignación', vehicle: null, fromVehicle: veh._id,
      user: { id: 'u-1', name: 'Ana Operaria' }, correctedAt: cuando,
    });

    const leida = await db.History.findById(creada._id).lean();
    expect(leida.user).toEqual({ id: 'u-1', name: 'Ana Operaria' });
    expect(String(leida.fromVehicle)).toBe(String(veh._id));
    expect(leida.correctedAt.getTime()).toBe(cuando.getTime());
  });

  it('una entrada sin autor no inventa uno: user queda ausente', async () => {
    const tire = await crearCubierta();
    const creada = await db.History.create({ tire: tire._id, type: 'Alta', status: 'Nueva' });
    const leida = await db.History.findById(creada._id).lean();
    expect(leida.user).toBeUndefined();
    expect(leida.fromVehicle).toBeUndefined();
  });
});

describe('corregir un movimiento (S6)', () => {
  it('el vehículo que no cambió no figura como editado', async () => {
    const veh = await crearVehiculo();
    const tire = await crearCubierta();
    const asig = await montar(tire, veh);

    const res = await request(app).patch(`/api/tires/${tire._id}/history/${asig._id}`).set(auth)
      .send({ form: { kmAlta: 1200, vehicle: String(veh._id), orderNumber: '2026-000201' } });

    expect(res.status).toBe(200);
    expect(res.body.editedFields).toEqual(['kmAlta']);
  });

  it('la entrada original conserva su tipo y queda marcada con motivo y fecha de corrección', async () => {
    const veh = await crearVehiculo();
    const tire = await crearCubierta();
    const asig = await montar(tire, veh);

    const res = await request(app).patch(`/api/tires/${tire._id}/history/${asig._id}`).set(auth)
      .send({ form: { kmAlta: 1500, vehicle: String(veh._id), orderNumber: '2026-000202' } });
    expect(res.status).toBe(200);

    const original = await db.History.findById(asig._id);
    expect(original.type).toBe('Asignación');
    expect(original.flag).toBe(true);
    expect(original.reason).toMatch(/Corregido en la orden/);
    expect(original.correctedAt).toBeInstanceOf(Date);

    const correccion = await db.History.findOne({ corrects: asig._id });
    expect(correccion.type).toBe('Corrección-Asignación');
    expect(correccion.kmAlta).toBe(1500);
  });

  it('corregir solo el km de una asignación no desmonta la cubierta', async () => {
    const veh = await crearVehiculo();
    const tire = await crearCubierta();
    const asig = await montar(tire, veh);

    const res = await request(app).patch(`/api/tires/${tire._id}/history/${asig._id}`).set(auth)
      .send({ form: { kmAlta: 1300, orderNumber: '2026-000203' } });
    expect(res.status).toBe(200);

    const despues = await db.Tire.findById(tire._id);
    expect(String(despues.vehicle)).toBe(String(veh._id));
    expect(despues.position).toBe('E1-I');
    const correccion = await db.History.findOne({ corrects: asig._id });
    expect(String(correccion.vehicle)).toBe(String(veh._id));
  });
});

describe('corregir el vehículo de una asignación (N6)', () => {
  it('la cubierta pasa al vehículo nuevo SIN la posición del vehículo viejo', async () => {
    const v1 = await crearVehiculo();
    const v2 = await crearVehiculo();
    const tire = await crearCubierta();
    const asig = await montar(tire, v1, 'E2-DE');

    const res = await request(app).patch(`/api/tires/${tire._id}/history/${asig._id}`).set(auth)
      .send({ form: { vehicle: String(v2._id), orderNumber: '2026-000204' } });
    expect(res.status).toBe(200);
    expect(res.body.editedFields).toEqual(['vehicle']);

    const despues = await db.Tire.findById(tire._id);
    expect(String(despues.vehicle)).toBe(String(v2._id));
    expect(despues.position).toBeNull();
    const correccion = await db.History.findOne({ corrects: asig._id });
    expect(correccion.position).toBeNull();
  });
});
