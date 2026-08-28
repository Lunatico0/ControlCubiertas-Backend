import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../../app.js';
import { connectControlPlane, closeControlPlane } from '../../db/controlPlane.js';
import { initBaseConnection, getTenantDb, closeAll } from '../../db/tenantConnections.js';
import { createTenantAndToken } from '../helpers/tenantAuth.js';

// t5 — El contrato del número de orden estaba desalineado: el frontend lo exige en los ocho
// caminos operativos y lo manda formateado como AAAA-NNNNNN, mientras que el backend lo
// aceptaba vacío y con cualquier forma. La fuente de verdad es el BACKEND: un comprobante sin
// número de orden, o con un número que no respeta el correlativo, no es auditable.
//
// Los caminos que NO emiten comprobante (alta de vehículo con cubiertas) siguen sin orden:
// no pasan por estos schemas.

let mongod;
let auth;
let db;
const dbName = 'tenant_contrato_orden';

let seq = 6000;
let orden = 0;
const nuevaOrden = () => `2026-${String(++orden).padStart(6, '0')}`;

const mkTire = () => db.Tire.create({
  status: 'Nueva', code: ++seq, brand: 'Pirelli', pattern: 'P1',
  size: '295/80 R22.5', serialNumber: `SN${seq}`,
});
const mkVehicle = () => db.Vehicle.create({
  brand: 'Scania', mobile: `O${++seq}`, licensePlate: `OO${seq}`, tires: [],
});

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
  mongod = await MongoMemoryServer.create();
  await connectControlPlane(mongod.getUri());
  initBaseConnection(mongod.getUri());
  db = getTenantDb(dbName).models;
  ({ auth } = await createTenantAndToken({ name: 'Contrato', dbName }));
});

afterAll(async () => {
  await closeAll();
  await closeControlPlane();
  await mongod.stop();
});

describe('el número de orden es obligatorio en los caminos que emiten comprobante', () => {
  it('POST /api/tires lo exige', async () => {
    const res = await request(app).post('/api/tires').set(auth).send({
      status: 'Nueva', code: ++seq, brand: 'B', pattern: 'P', size: 'S', serialNumber: `X${seq}`,
    });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('orderNumber');
  });

  it('PATCH /api/tires/:id/status lo exige', async () => {
    const tire = await mkTire();
    const res = await request(app).patch(`/api/tires/${tire._id}/status`).set(auth)
      .send({ status: 'A recapar' });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('orderNumber');
  });

  it('PATCH /api/tires/:id/assign lo exige', async () => {
    const tire = await mkTire();
    const veh = await mkVehicle();
    const res = await request(app).patch(`/api/tires/${tire._id}/assign`).set(auth)
      .send({ vehicle: veh._id.toString(), kmAlta: 100 });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('orderNumber');
  });

  it('PATCH /api/tires/:id/unassign lo exige', async () => {
    const tire = await mkTire();
    const res = await request(app).patch(`/api/tires/${tire._id}/unassign`).set(auth)
      .send({ kmBaja: 500 });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('orderNumber');
  });

  it('PATCH /api/tires/:id/correct lo exige', async () => {
    const tire = await mkTire();
    const res = await request(app).patch(`/api/tires/${tire._id}/correct`).set(auth)
      .send({ form: { brand: 'Otra' } });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('orderNumber');
  });
});

describe('el número de orden se normaliza a AAAA-NNNNNN', () => {
  it('normaliza los dígitos crudos que manda /op', async () => {
    const tire = await mkTire();
    const res = await request(app).patch(`/api/tires/${tire._id}/status`).set(auth)
      .send({ status: 'A recapar', orderNumber: '123' });
    expect(res.status).toBe(200);
    const mov = await db.History.findOne({ tire: tire._id, type: 'Estado' });
    expect(mov.orderNumber).toBe(`${new Date().getFullYear()}-000123`);
  });

  it('deja intacto el número que ya viene formateado', async () => {
    const tire = await mkTire();
    const numero = nuevaOrden();
    const res = await request(app).patch(`/api/tires/${tire._id}/status`).set(auth)
      .send({ status: 'A recapar', orderNumber: numero });
    expect(res.status).toBe(200);
    const mov = await db.History.findOne({ tire: tire._id, type: 'Estado' });
    expect(mov.orderNumber).toBe(numero);
  });

  it('rechaza el cero', async () => {
    const tire = await mkTire();
    const res = await request(app).patch(`/api/tires/${tire._id}/status`).set(auth)
      .send({ status: 'A recapar', orderNumber: '0' });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('orderNumber');
  });

  it('rechaza un número con letras', async () => {
    const tire = await mkTire();
    const res = await request(app).patch(`/api/tires/${tire._id}/status`).set(auth)
      .send({ status: 'A recapar', orderNumber: '2026-ABC123' });
    expect(res.status).toBe(400);
  });

  it('acepta el formato que manda el front', async () => {
    const tire = await mkTire();
    const res = await request(app).patch(`/api/tires/${tire._id}/status`).set(auth)
      .send({ status: 'A recapar', orderNumber: nuevaOrden() });
    expect(res.status).toBe(200);
  });
});

describe('el flujo completo con orden válida sigue funcionando', () => {
  it('alta, asignación y desasignación con número de orden formateado', async () => {
    const veh = await mkVehicle();
    const alta = await request(app).post('/api/tires').set(auth).send({
      status: 'Nueva', code: ++seq, brand: 'B', pattern: 'P', size: 'S',
      serialNumber: `Y${seq}`, orderNumber: nuevaOrden(),
    });
    expect(alta.status).toBe(201);
    const tireId = alta.body.tire?._id || alta.body._id;

    const asig = await request(app).patch(`/api/tires/${tireId}/assign`).set(auth)
      .send({ vehicle: veh._id.toString(), kmAlta: 1000, orderNumber: nuevaOrden() });
    expect(asig.status).toBe(200);

    const desas = await request(app).patch(`/api/tires/${tireId}/unassign`).set(auth)
      .send({ kmBaja: 2000, orderNumber: nuevaOrden() });
    expect(desas.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// t4 · La fecha de alta no se corre de día (defensa en el backend)
// ─────────────────────────────────────────────────────────────────────────────
describe('createdAt: un día suelto no se corre de día (t4)', () => {
  it('ancla YYYY-MM-DD al mediodía UTC en vez de a la medianoche', async () => {
    const res = await request(app).post('/api/tires').set(auth).send({
      status: 'Nueva', code: ++seq, brand: 'B', pattern: 'P', size: 'S',
      serialNumber: `F${seq}`, orderNumber: nuevaOrden(), createdAt: '2026-03-15',
    });
    expect(res.status).toBe(201);
    const guardada = await db.Tire.findOne({ code: seq });
    const alta = await db.History.findOne({ tire: guardada._id, type: 'Alta' });
    expect(alta.date.toISOString()).toBe('2026-03-15T12:00:00.000Z');
  });

  it('deja intacta una fecha que ya trae hora', async () => {
    const res = await request(app).post('/api/tires').set(auth).send({
      status: 'Nueva', code: ++seq, brand: 'B', pattern: 'P', size: 'S',
      serialNumber: `G${seq}`, orderNumber: nuevaOrden(), createdAt: '2026-03-15T08:30:00.000Z',
    });
    expect(res.status).toBe(201);
    const guardada = await db.Tire.findOne({ code: seq });
    const alta = await db.History.findOne({ tire: guardada._id, type: 'Alta' });
    expect(alta.date.toISOString()).toBe('2026-03-15T08:30:00.000Z');
  });
});
