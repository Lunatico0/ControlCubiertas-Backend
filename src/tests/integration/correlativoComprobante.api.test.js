import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../../app.js';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { initBaseConnection, closeAll, getTenantDb } from '../../db/tenantConnections.js';
import { createTenantAndToken } from '../helpers/tenantAuth.js';

// El correlativo de comprobante NO puede quemarse por un intento fallido.
//
// Reproducido en el QA de operario: dos intentos rechazados de desasignar (km final menor al
// de alta) consumieron los números 281 y 282, y el tercero, válido, emitió el 283 cuando el
// último movimiento real había sido el 280. Los números 281 y 282 no existen en ningún papel
// y nadie puede explicar qué pasó con ellos.
//
// La causa es de orden: el número se pide ANTES de ejecutar la mutación. El arreglo es que lo
// reserve el backend DENTRO de la operación, una vez que las validaciones ya pasaron.

let mongod;
let auth;
let db;
let seq = 700;

const DB_NAME = 'tenant_correlativo';

const crearCubierta = async () => {
  const res = await request(app).post('/api/tires').set(auth).send({
    status: 'Nueva', code: ++seq, brand: 'B', pattern: 'P', size: '295/80', serialNumber: `SN${seq}`,
  });
  return res.body.tire?._id || res.body._id;
};

const crearVehiculo = () =>
  db.Vehicle.create({ brand: 'Scania', mobile: `M${++seq}`, licensePlate: `CCC${seq}`, axles: [{ type: 'simple' }] });

const numeroActual = async () => (await db.ReceiptCounter.findOne({ pointOfSale: 1 }))?.currentNumber ?? 0;

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await connectControlPlane(uri);
  initBaseConnection(uri);
  await getControlModels().User.init();
  ({ auth } = await createTenantAndToken({ name: 'Correlativo', dbName: DB_NAME }));
  db = getTenantDb(DB_NAME).models;
});

afterAll(async () => {
  await closeControlPlane();
  await closeAll();
  await mongod.stop();
});

describe('correlativo de comprobante', () => {
  it('una desasignación RECHAZADA no consume número', async () => {
    const tireId = await crearCubierta();
    const v = await crearVehiculo();
    await request(app).patch(`/api/tires/${tireId}/assign`).set(auth)
      .send({ vehicle: String(v._id), kmAlta: 50000, orderNumber: 'O-1' });

    const antes = await numeroActual();

    // km de baja MENOR al de alta: el servicio lo rechaza con 400.
    const res = await request(app).patch(`/api/tires/${tireId}/unassign`).set(auth)
      .send({ kmBaja: 100, orderNumber: 'O-2' });
    expect(res.status).toBe(400);

    expect(await numeroActual()).toBe(antes);
  });

  it('dos rechazos seguidos y después una válida: el correlativo no salta', async () => {
    const tireId = await crearCubierta();
    const v = await crearVehiculo();
    await request(app).patch(`/api/tires/${tireId}/assign`).set(auth)
      .send({ vehicle: String(v._id), kmAlta: 50000, orderNumber: 'O-3' });

    const antes = await numeroActual();

    await request(app).patch(`/api/tires/${tireId}/unassign`).set(auth).send({ kmBaja: 10, orderNumber: 'O-4' });
    await request(app).patch(`/api/tires/${tireId}/unassign`).set(auth).send({ kmBaja: 20, orderNumber: 'O-5' });

    const ok = await request(app).patch(`/api/tires/${tireId}/unassign`).set(auth)
      .send({ kmBaja: 60000, orderNumber: 'O-6' });
    expect(ok.status).toBe(200);

    // Exactamente UNO consumido: el de la operación que sí ocurrió.
    expect(await numeroActual()).toBe(antes + 1);
  });

  it('la mutación exitosa devuelve el número emitido y queda guardado en el historial', async () => {
    const tireId = await crearCubierta();
    const v = await crearVehiculo();
    const res = await request(app).patch(`/api/tires/${tireId}/assign`).set(auth)
      .send({ vehicle: String(v._id), kmAlta: 1000, orderNumber: 'O-7' });

    expect(res.status).toBe(200);
    expect(res.body.receiptNumber).toMatch(/^\d{4}-\d{8}$/);

    const entrada = (await db.History.find({ tire: tireId, type: 'Asignación' }))[0];
    expect(entrada.receiptNumber).toBe(res.body.receiptNumber);
  });

  it('si el cliente manda un receiptNumber, se respeta y no se reserva otro', async () => {
    // Compatibilidad con el front actual, que todavía pide el número antes de la mutación.
    const tireId = await crearCubierta();
    const v = await crearVehiculo();
    const antes = await numeroActual();

    const res = await request(app).patch(`/api/tires/${tireId}/assign`).set(auth)
      .send({ vehicle: String(v._id), kmAlta: 1000, orderNumber: 'O-8', receiptNumber: '0001-00009999' });

    expect(res.status).toBe(200);
    expect(res.body.receiptNumber).toBe('0001-00009999');
    expect(await numeroActual()).toBe(antes);
  });

  it('un alta rechazada tampoco consume número', async () => {
    const antes = await numeroActual();
    const res = await request(app).post('/api/tires').set(auth).send({
      status: 'Nueva', code: -5, brand: 'B', pattern: 'P', size: 'S', serialNumber: 'SN-INVALIDA',
    });
    expect(res.status).toBe(400);
    expect(await numeroActual()).toBe(antes);
  });
});
