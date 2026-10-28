import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../../app.js';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { initBaseConnection, closeAll, getTenantDb } from '../../db/tenantConnections.js';
import { createTenantAndToken } from '../helpers/tenantAuth.js';

// S4 (auditoría 26/10): una cubierta MONTADA podía pasar a "A recapar" o a "Descartada" sin
// bajarla del vehículo. Quedaba una cubierta en recapadora (o dada de baja) ocupando una
// posición del camión. El guard va por ROL del tenant, nunca por nombre: este tenant llama
// "Para recapar" y "Baja" a esos estados a propósito.

let mongod;
let auth;
let db;
let seq = 9300;

const DB_NAME = 'tenant_estado_montada';

const ESTADOS = [
  { name: '0 km', role: 'initial' },
  { name: '1er Recapado', role: 'stock' },
  { name: 'Para recapar', role: 'recap' },
  { name: 'Baja', role: 'discard' },
];

const numeroActual = async () => (await db.ReceiptCounter.findOne({ pointOfSale: 1 }))?.currentNumber ?? 0;

const crearMontada = async () => {
  const veh = await db.Vehicle.create({
    brand: 'Scania', mobile: `M${++seq}`, licensePlate: `EM${seq}`, axles: [{ type: 'simple' }],
  });
  // Por la API: así la cubierta tiene su entrada de Alta, como cualquier cubierta real.
  const alta = await request(app).post('/api/tires').set(auth).send({
    status: '0 km', code: ++seq, brand: 'B', pattern: 'P', size: '295/80', serialNumber: `SN${seq}`, orderNumber: '2026-000099' });
  expect(alta.status).toBe(201);
  const tire = alta.body;
  const res = await request(app).patch(`/api/tires/${tire._id}/assign`).set(auth)
    .send({ vehicle: String(veh._id), kmAlta: 1000, position: 'E1-I', orderNumber: '2026-000100' });
  expect(res.status).toBe(200);
  return { tire, veh };
};

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await connectControlPlane(uri);
  initBaseConnection(uri);
  await getControlModels().User.init();
  const creado = await createTenantAndToken({ name: 'Estado montada', dbName: DB_NAME });
  auth = creado.auth;
  await getControlModels().Tenant.updateOne({ _id: creado.tenant._id }, { $set: { stockStatuses: ESTADOS } });
  db = getTenantDb(DB_NAME).models;
});

afterAll(async () => {
  await closeControlPlane();
  await closeAll();
  await mongod.stop();
});

describe('cambiar el estado de una cubierta montada (S4)', () => {
  it.each([
    ['Para recapar', /recapar/i],
    ['Baja', /baja/i],
  ])('a "%s" (rol recap / discard) responde 409, sin entrada nueva y sin consumir número', async (estado, motivo) => {
    const { tire } = await crearMontada();
    const antes = await numeroActual();
    const entradasAntes = await db.History.countDocuments({ tire: tire._id });

    const res = await request(app).patch(`/api/tires/${tire._id}/status`).set(auth)
      .send({ status: estado, orderNumber: '2026-000101' });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/desmontala primero/i);
    expect(res.body.message).toMatch(motivo);
    expect(await numeroActual()).toBe(antes);
    expect(await db.History.countDocuments({ tire: tire._id })).toBe(entradasAntes);
    const sinTocar = await db.Tire.findById(tire._id);
    expect(sinTocar.status).toBe('0 km');
    expect(sinTocar.vehicle).toBeTruthy();
  });

  it('un estado de la escalera (rol stock) sigue permitido con la cubierta montada', async () => {
    const { tire } = await crearMontada();
    const res = await request(app).patch(`/api/tires/${tire._id}/status`).set(auth)
      .send({ status: '1er Recapado', orderNumber: '2026-000102' });
    expect(res.status).toBe(200);
  });

  it('desmontada, la misma cubierta sí puede pasar a recapar', async () => {
    const { tire } = await crearMontada();
    const baja = await request(app).patch(`/api/tires/${tire._id}/unassign`).set(auth)
      .send({ kmBaja: 5000, orderNumber: '2026-000103' });
    expect(baja.status).toBe(200);

    const res = await request(app).patch(`/api/tires/${tire._id}/status`).set(auth)
      .send({ status: 'Para recapar', orderNumber: '2026-000104' });
    expect(res.status).toBe(200);
    expect((await db.Tire.findById(tire._id)).status).toBe('Para recapar');
  });
});
