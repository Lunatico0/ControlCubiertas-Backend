import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { registerModels } from '../../db/registerModels.js';
import tireService from '../../services/tire.service.js';

// A3: asignar una cubierta a una POSICIÓN del eje (validando que exista y esté libre),
// y que la desasignación la libere. Vehículo de prueba = camión 4×2:
// eje 1 simple (E1-I, E1-D) + eje 2 dual (E2-IE, E2-II, E2-DI, E2-DE).
describe('assign/unassign con posición de eje', () => {
  let mongod;
  let conn;
  let db;
  let seq = 100;

  const mkBase = () => ({
    status: 'Nueva', code: ++seq, brand: 'B', pattern: 'P', size: 'S', serialNumber: `SN${seq}`,
  });

  const makeVehicle = (axles = [{ type: 'simple' }, { type: 'dual' }]) =>
    db.Vehicle.create({ brand: 'Scania', mobile: `M${++seq}`, licensePlate: `P${seq}`, axles });

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    conn = mongoose.createConnection(mongod.getUri());
    await conn.asPromise();
    db = registerModels(conn);
  });

  afterAll(async () => {
    await conn.close();
    await mongod.stop();
  });

  it('asigna en una posición válida y libre del vehículo', async () => {
    const v = await makeVehicle();
    const t = await db.Tire.create(mkBase());
    const tire = await tireService.assignVehicle(db, String(t._id), String(v._id), 1000, 'ORD', null, 'E2-DE');
    expect(String(tire.vehicle._id || tire.vehicle)).toBe(String(v._id));
    expect(tire.position).toBe('E2-DE');
  });

  it('rechaza una posición que no existe en el vehículo', async () => {
    const v = await makeVehicle();
    const t = await db.Tire.create(mkBase());
    await expect(
      tireService.assignVehicle(db, String(t._id), String(v._id), 1000, 'ORD', null, 'E9-XX'),
    ).rejects.toThrow(/no existe/i);
  });

  it('rechaza una posición ya ocupada por otra cubierta del vehículo', async () => {
    const v = await makeVehicle();
    const t1 = await db.Tire.create(mkBase());
    const t2 = await db.Tire.create(mkBase());
    await tireService.assignVehicle(db, String(t1._id), String(v._id), 1000, 'O', null, 'E1-I');
    await expect(
      tireService.assignVehicle(db, String(t2._id), String(v._id), 1000, 'O', null, 'E1-I'),
    ).rejects.toThrow(/ocupada/i);
  });

  it('permite asignar sin posición (retrocompatible con el flujo viejo)', async () => {
    const v = await makeVehicle();
    const t = await db.Tire.create(mkBase());
    const tire = await tireService.assignVehicle(db, String(t._id), String(v._id), 1000, 'O', null);
    expect(tire.position ?? null).toBeNull();
  });

  it('la desasignación libera la posición', async () => {
    const v = await makeVehicle();
    const t = await db.Tire.create({ ...mkBase(), vehicle: v._id, position: 'E1-I' });
    v.tires.push(t._id);
    await v.save();
    // El estado se recalcula desde el historial: necesita el Alta antes de la Asignación.
    await db.History.create({
      tire: t._id, type: 'Alta', status: 'Nueva', km: 0, date: new Date('2026-01-01'),
    });
    await db.History.create({
      tire: t._id, type: 'Asignación', vehicle: v._id, kmAlta: 1000, status: 'Nueva', date: new Date('2026-01-02'),
    });

    const { tire } = await tireService.unassignVehicle(db, String(t._id), 1500, 'ORD', null);
    expect(tire.position ?? null).toBeNull();
  });
});
