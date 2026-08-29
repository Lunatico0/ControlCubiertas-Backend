import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../../app.js';
import { connectControlPlane, closeControlPlane } from '../../db/controlPlane.js';
import { initBaseConnection, getTenantDb, closeAll } from '../../db/tenantConnections.js';
import { createTenantAndToken } from '../helpers/tenantAuth.js';
import TireService from '../../services/tire.service.js';

// t28 — el código más enredado del backend no tenía un solo test: correctData,
// correctHistoryEntry, undoHistoryEntry y los dos PUT de vehículos. Tres de los hallazgos
// críticos de la auditoría estaban exactamente ahí. Estos tests fijan los invariantes:
// vehicle.tires[] y tire.vehicle siempre de acuerdo, y ningún movimiento fantasma.

let mongod;
let auth;
let db;
const dbName = 'tenant_correcciones';

const statuses = [
  { name: 'Nueva', role: 'initial' },
  { name: '1er Recapado', role: 'stock' },
  { name: 'A recapar', role: 'recap' },
  { name: 'Descartada', role: 'discard' },
];

let seq = 5000;
const mkTire = (extra = {}) => db.Tire.create({
  status: 'Nueva', code: ++seq, brand: 'Pirelli', pattern: 'P1',
  size: '295/80 R22.5', serialNumber: `SN${seq}`, ...extra,
});
const mkVehicle = (mobile) => db.Vehicle.create({
  brand: 'Scania', mobile, licensePlate: `XX${++seq}`, tires: [],
});

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
  mongod = await MongoMemoryServer.create();
  await connectControlPlane(mongod.getUri());
  initBaseConnection(mongod.getUri());
  db = getTenantDb(dbName).models;
  ({ auth } = await createTenantAndToken({ name: 'Correcciones', dbName }));
});

afterAll(async () => {
  await closeAll();
  await closeControlPlane();
  await mongod.stop();
});

describe('correctData (corrección de los datos de alta)', () => {
  it('corrige sólo los campos permitidos y deja una entrada Corrección-Alta', async () => {
    const tire = await mkTire({ brand: 'Michelin' });
    const res = await TireService.correctData(db, tire._id.toString(), {
      form: { brand: 'Pirelli', size: '11R22.5', reason: 'error de tipeo', orderNumber: '100' },
    });

    expect(res.editedFields.sort()).toEqual(['brand', 'size']);
    expect(res.fieldChanges.brand).toEqual({ before: 'Michelin', after: 'Pirelli' });
    const entradas = await db.History.find({ tire: tire._id, type: 'Corrección-Alta' });
    expect(entradas).toHaveLength(1);
    expect(entradas[0].flag).toBe(true);
    expect(entradas[0].editedFields.sort()).toEqual(['brand', 'size']);
  });

  it('rechaza con 400 si no hay bloque form', async () => {
    const tire = await mkTire();
    await expect(TireService.correctData(db, tire._id.toString(), {}))
      .rejects.toMatchObject({ status: 400 });
  });

  it('rechaza con 400 y NO gasta número de comprobante si no hay cambios reales', async () => {
    const tire = await mkTire({ brand: 'Pirelli' });
    const antes = await db.History.countDocuments({ receiptNumber: { $ne: '0000-00000000' } });
    await expect(TireService.correctData(db, tire._id.toString(), { form: { brand: 'Pirelli' } }))
      .rejects.toMatchObject({ status: 400 });
    const despues = await db.History.countDocuments({ receiptNumber: { $ne: '0000-00000000' } });
    expect(despues).toBe(antes);
  });
});

describe('correctHistoryEntry (corrección de un movimiento)', () => {
  it('corregir el vehículo de una Asignación mueve la cubierta y alinea los dos lados', async () => {
    const v1 = await mkVehicle('C-A1');
    const v2 = await mkVehicle('C-A2');
    const tire = await mkTire();
    await db.History.create({
      tire: tire._id, type: 'Alta', status: 'Nueva', kmAlta: 0, date: new Date(2026, 0, 1),
    });
    const asig = await db.History.create({
      tire: tire._id, type: 'Asignación', vehicle: v1._id, kmAlta: 100, status: 'Nueva',
      orderNumber: '200', date: new Date(2026, 0, 2),
    });
    tire.vehicle = v1._id;
    await tire.save();
    v1.tires = [tire._id];
    await v1.save();

    await TireService.correctHistoryEntry(db, tire._id.toString(), asig._id.toString(), {
      form: { vehicle: v2._id.toString(), orderNumber: '201' },
    });

    const tireAfter = await db.Tire.findById(tire._id);
    expect(String(tireAfter.vehicle)).toBe(String(v2._id));
    const v1After = await db.Vehicle.findById(v1._id);
    const v2After = await db.Vehicle.findById(v2._id);
    expect(v1After.tires.map(String)).not.toContain(String(tire._id));
    expect(v2After.tires.map(String)).toContain(String(tire._id));
  });

  it('devuelve 404 y no gasta número si el movimiento no existe', async () => {
    const tire = await mkTire();
    const antes = await db.History.countDocuments({ receiptNumber: { $ne: '0000-00000000' } });
    await expect(TireService.correctHistoryEntry(
      db, tire._id.toString(), '507f1f77bcf86cd799439011', { form: { status: 'A recapar' } },
    )).rejects.toMatchObject({ status: 404 });
    const despues = await db.History.countDocuments({ receiptNumber: { $ne: '0000-00000000' } });
    expect(despues).toBe(antes);
  });

  it('rechaza con 400 cuando no hay ningún campo cambiado', async () => {
    const tire = await mkTire();
    const mov = await db.History.create({
      tire: tire._id, type: 'Estado', status: 'A recapar', date: new Date(2026, 0, 3),
    });
    await expect(TireService.correctHistoryEntry(
      db, tire._id.toString(), mov._id.toString(), { form: { status: 'A recapar' } },
    )).rejects.toMatchObject({ status: 400 });
  });
});

describe('undoHistoryEntry: guardas', () => {
  it('no deja deshacer un Alta (para eso está descartar)', async () => {
    const tire = await mkTire();
    const alta = await db.History.create({
      tire: tire._id, type: 'Alta', status: 'Nueva', kmAlta: 0, date: new Date(2026, 0, 1),
    });
    await expect(TireService.undoHistoryEntry(
      db, tire._id.toString(), alta._id.toString(), { orderNumber: '300' }, statuses,
    )).rejects.toMatchObject({ status: 409 });
  });

  it('devuelve 404 y no gasta número si la entrada no existe', async () => {
    const tire = await mkTire();
    const antes = await db.History.countDocuments({ receiptNumber: { $ne: '0000-00000000' } });
    await expect(TireService.undoHistoryEntry(
      db, tire._id.toString(), '507f1f77bcf86cd799439011', { orderNumber: '301' }, statuses,
    )).rejects.toMatchObject({ status: 404 });
    const despues = await db.History.countDocuments({ receiptNumber: { $ne: '0000-00000000' } });
    expect(despues).toBe(antes);
  });
});

describe('PUT /api/vehicles/:id (cubiertas del vehículo)', () => {
  it('asigna y desasigna manteniendo los dos lados de la relación', async () => {
    const veh = await mkVehicle('P-1');
    const t1 = await mkTire();
    const t2 = await mkTire();

    const res = await request(app)
      .put(`/api/vehicles/${veh._id}`)
      .set(auth)
      .send({ tires: [t1._id.toString(), t2._id.toString()] });
    expect(res.status).toBe(200);

    const vehAfter = await db.Vehicle.findById(veh._id);
    expect(vehAfter.tires.map(String).sort()).toEqual([String(t1._id), String(t2._id)].sort());
    expect(String((await db.Tire.findById(t1._id)).vehicle)).toBe(String(veh._id));

    // Ahora se saca t2.
    const res2 = await request(app)
      .put(`/api/vehicles/${veh._id}`)
      .set(auth)
      .send({ tires: [t1._id.toString()] });
    expect(res2.status).toBe(200);

    const vehFinal = await db.Vehicle.findById(veh._id);
    expect(vehFinal.tires.map(String)).toEqual([String(t1._id)]);
    expect((await db.Tire.findById(t2._id)).vehicle).toBeNull();
  });

  it('NO genera un movimiento fantasma por una cubierta que ya estaba montada', async () => {
    const veh = await mkVehicle('P-2');
    const t1 = await mkTire();

    await request(app).put(`/api/vehicles/${veh._id}`).set(auth).send({ tires: [t1._id.toString()] });
    const asignacionesPrimera = await db.History.countDocuments({ tire: t1._id, type: 'Asignación' });
    expect(asignacionesPrimera).toBe(1);

    // Se vuelve a guardar el MISMO conjunto: nada cambió, no debería registrar nada.
    await request(app).put(`/api/vehicles/${veh._id}`).set(auth).send({ tires: [t1._id.toString()] });
    const asignacionesSegunda = await db.History.countDocuments({ tire: t1._id, type: 'Asignación' });
    expect(asignacionesSegunda).toBe(1);
  });

  it('rechaza con 400 una cubierta ya montada en otro vehículo', async () => {
    const vA = await mkVehicle('P-3');
    const vB = await mkVehicle('P-4');
    const t = await mkTire();
    await request(app).put(`/api/vehicles/${vA._id}`).set(auth).send({ tires: [t._id.toString()] });

    const res = await request(app).put(`/api/vehicles/${vB._id}`).set(auth).send({ tires: [t._id.toString()] });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/asignadas a otros vehículos/i);
  });

  it('no mete refs colgadas: un id de cubierta inexistente no entra en vehicle.tires[]', async () => {
    const veh = await mkVehicle('P-5');
    const t = await mkTire();
    const res = await request(app)
      .put(`/api/vehicles/${veh._id}`)
      .set(auth)
      .send({ tires: [t._id.toString(), '507f1f77bcf86cd799439011'] });
    expect(res.status).toBe(200);
    const vehAfter = await db.Vehicle.findById(veh._id);
    expect(vehAfter.tires.map(String)).toEqual([String(t._id)]);
  });

  it('devuelve 404 con un vehículo inexistente', async () => {
    const res = await request(app)
      .put('/api/vehicles/507f1f77bcf86cd799439011')
      .set(auth)
      .send({ tires: [] });
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/vehicles/details/:id (datos del vehículo)', () => {
  it('actualiza los datos y normaliza la patente', async () => {
    const veh = await mkVehicle('D-1');
    const res = await request(app)
      .put(`/api/vehicles/details/${veh._id}`)
      .set(auth)
      .send({ mobile: 'D-1b', licensePlate: 'abc-301', brand: 'Volvo', type: 'Camión' });
    expect(res.status).toBe(200);
    expect(res.body.licensePlate).toBe('ABC301');
    expect(res.body.mobile).toBe('D-1b');
  });

  it('rechaza con 400 un móvil duplicado y no toca el documento', async () => {
    const vA = await mkVehicle('D-2');
    const vB = await mkVehicle('D-3');
    const res = await request(app)
      .put(`/api/vehicles/details/${vB._id}`)
      .set(auth)
      .send({ mobile: vA.mobile, licensePlate: 'ZZZ999', brand: 'Volvo', type: 'Camión' });
    expect(res.status).toBe(400);
    const sinTocar = await db.Vehicle.findById(vB._id);
    expect(sinTocar.mobile).toBe('D-3');
  });

  it('rechaza con 400 una patente duplicada aunque venga con separadores distintos', async () => {
    const vA = await mkVehicle('D-4');
    vA.licensePlate = 'AB123CD';
    await vA.save();
    const vB = await mkVehicle('D-5');
    const res = await request(app)
      .put(`/api/vehicles/details/${vB._id}`)
      .set(auth)
      .send({ mobile: 'D-5', licensePlate: 'ab-123-cd', brand: 'Volvo', type: 'Camión' });
    expect(res.status).toBe(400);
  });

  it('devuelve 404 con un vehículo inexistente', async () => {
    const res = await request(app)
      .put('/api/vehicles/details/507f1f77bcf86cd799439011')
      .set(auth)
      .send({ mobile: 'X', licensePlate: 'XX111XX', brand: 'V', type: 'Camión' });
    expect(res.status).toBe(404);
  });
});
