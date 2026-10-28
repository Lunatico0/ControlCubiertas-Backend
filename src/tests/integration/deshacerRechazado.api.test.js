import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../../app.js';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { initBaseConnection, closeAll, getTenantDb } from '../../db/tenantConnections.js';
import { createTenantAndToken } from '../helpers/tenantAuth.js';

// N1 (hallazgo nuevo del plan de la auditoría 26/10): un deshacer RECHAZADO ya había
// reservado un número de comprobante y marcado la entrada original como deshecha ("Deshecho en
// la orden ...", tipo Corrección-*) antes de llegar al 409/400. Quedaba un número quemado y una
// entrada que dice haber sido deshecha sin que exista el deshacer.

let mongod;
let auth;
let db;
let seq = 9950;

const DB_NAME = 'tenant_deshacer_rechazado';

const numeroActual = async () => (await db.ReceiptCounter.findOne({ pointOfSale: 1 }))?.currentNumber ?? 0;

const crearCubierta = () => db.Tire.create({
  status: 'Nueva', code: ++seq, brand: 'B', pattern: 'P', size: '295/80', serialNumber: `SN${seq}`,
});

const entrada = (tire, extra) => db.History.create({
  tire: tire._id, status: 'Nueva', orderNumber: '2026-000400', receiptNumber: '0001-00000001', ...extra,
});

// Provoca el rechazo y verifica el patrón de correlativoComprobante: contador igual, cero
// entradas nuevas y la entrada original sin marcas.
const rechazoLimpio = async (tire, original, status) => {
  const antes = await numeroActual();
  const entradasAntes = await db.History.countDocuments({});

  const res = await request(app).post(`/api/tires/${tire._id}/history/${original._id}/undo`).set(auth)
    .send({ orderNumber: '2026-000401', reason: 'probando' });

  expect(res.status).toBe(status);
  expect(await numeroActual()).toBe(antes);
  expect(await db.History.countDocuments({})).toBe(entradasAntes);

  const despues = await db.History.findById(original._id).lean();
  expect(despues.type).toBe(original.type);
  expect(despues.flag).toBe(false);
  expect(despues.reason).toBeUndefined();
  expect(despues.editedFields).toEqual([]);
  expect(despues.correctedAt).toBeUndefined();
};

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await connectControlPlane(uri);
  initBaseConnection(uri);
  await getControlModels().User.init();
  ({ auth } = await createTenantAndToken({ name: 'Deshacer rechazado', dbName: DB_NAME }));
  db = getTenantDb(DB_NAME).models;
});

afterAll(async () => {
  await closeControlPlane();
  await closeAll();
  await mongod.stop();
});

describe('un deshacer rechazado no deja rastro (N1)', () => {
  it('deshacer un Alta: 409 sin número consumido y con el Alta intacta', async () => {
    const tire = await crearCubierta();
    const alta = await entrada(tire, { type: 'Alta', date: new Date(2026, 0, 1) });
    await rechazoLimpio(tire, alta, 409);
  });

  it('deshacer una desasignación sin asignación previa: 409 sin número consumido', async () => {
    const tire = await crearCubierta();
    await entrada(tire, { type: 'Alta', date: new Date(2026, 0, 1) });
    const desas = await entrada(tire, {
      type: 'Desasignación', vehicle: null, kmBaja: 5000, date: new Date(2026, 0, 2),
    });
    await rechazoLimpio(tire, desas, 409);
  });

  it('deshacer un tipo no soportado: 400 sin número consumido', async () => {
    const tire = await crearCubierta();
    const otro = await entrada(tire, { type: 'Corrección-Otro', date: new Date(2026, 0, 2) });
    await rechazoLimpio(tire, otro, 400);
  });
});
