import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../../app.js';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { initBaseConnection, closeAll, getTenantDb } from '../../db/tenantConnections.js';
import { createTenantAndToken } from '../helpers/tenantAuth.js';
import TireService from '../../services/tire.service.js';

// S3 (auditoría 26/10): corregir los datos de alta con un código que ya usa OTRA cubierta
// respondía 400, pero antes de eso ya había reservado un número de comprobante y escrito una
// entrada "Corrección-Alta" que describe un cambio que nunca ocurrió. El 400 venía del índice
// único al guardar la cubierta, que era lo ÚLTIMO que hacía el servicio.

let mongod;
let auth;
let db;
let seq = 8800;

const DB_NAME = 'tenant_correccion_codigo';

const crearCubierta = () => db.Tire.create({
  status: 'Nueva', code: ++seq, brand: 'B', pattern: 'P', size: '295/80', serialNumber: `SN${seq}`,
});

const numeroActual = async () => (await db.ReceiptCounter.findOne({ pointOfSale: 1 }))?.currentNumber ?? 0;

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await connectControlPlane(uri);
  initBaseConnection(uri);
  await getControlModels().User.init();
  ({ auth } = await createTenantAndToken({ name: 'Correccion codigo', dbName: DB_NAME }));
  db = getTenantDb(DB_NAME).models;
  // El índice único de `code` tiene que existir para que el choque sea real.
  await db.Tire.init();
});

afterAll(async () => {
  await closeControlPlane();
  await closeAll();
  await mongod.stop();
});

describe('corregir el código de una cubierta a uno que ya existe (S3)', () => {
  it('responde 400 marcando el campo, sin entrada nueva y sin consumir número', async () => {
    const otra = await crearCubierta();
    const tire = await crearCubierta();
    const antes = await numeroActual();
    const entradasAntes = await db.History.countDocuments({});

    const res = await request(app).patch(`/api/tires/${tire._id}/correct`).set(auth)
      .send({ form: { code: otra.code, reason: 'tipeo', orderNumber: '2026-000050' } });

    expect(res.status).toBe(400);
    expect(res.body.field).toBe('code');
    expect(res.body.message).toMatch(String(otra.code));
    expect(await numeroActual()).toBe(antes);
    expect(await db.History.countDocuments({})).toBe(entradasAntes);
    expect((await db.Tire.findById(tire._id)).code).toBe(tire.code);
  });

  it('en el servicio, si el índice rebota el guardado, tampoco queda entrada ni número quemado', async () => {
    // Sin el pre-check del controller: es la defensa para la carrera entre dos correcciones.
    const otra = await crearCubierta();
    const tire = await crearCubierta();
    const antes = await numeroActual();
    const entradasAntes = await db.History.countDocuments({});

    await expect(TireService.correctData(db, tire._id.toString(), {
      form: { code: otra.code, orderNumber: '2026-000051' },
    })).rejects.toBeTruthy();

    expect(await numeroActual()).toBe(antes);
    expect(await db.History.countDocuments({})).toBe(entradasAntes);
  });

  it('mandar el código propio junto con otro cambio no se toma como duplicado', async () => {
    const tire = await crearCubierta();
    const res = await request(app).patch(`/api/tires/${tire._id}/correct`).set(auth)
      .send({ form: { code: tire.code, brand: 'Otra marca', orderNumber: '2026-000052' } });

    expect(res.status).toBe(200);
    expect(res.body.editedFields).toEqual(['brand']);
  });

  it('corregir a un código libre registra la corrección y consume un solo número', async () => {
    const tire = await crearCubierta();
    const antes = await numeroActual();
    const libre = seq + 1000;

    const res = await request(app).patch(`/api/tires/${tire._id}/correct`).set(auth)
      .send({ form: { code: libre, orderNumber: '2026-000053' } });

    expect(res.status).toBe(200);
    expect(await numeroActual()).toBe(antes + 1);
    expect((await db.Tire.findById(tire._id)).code).toBe(libre);
    const entradas = await db.History.find({ tire: tire._id, type: 'Corrección-Alta' });
    expect(entradas).toHaveLength(1);
    expect(entradas[0].receiptNumber).toBe(res.body.receiptNumber);
  });
});
