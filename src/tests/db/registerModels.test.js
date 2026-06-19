import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { registerModels } from '../../db/registerModels.js';

describe('registerModels(conn)', () => {
  let mongod;
  let conn;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    conn = mongoose.createConnection(mongod.getUri());
    await conn.asPromise();
  });

  afterAll(async () => {
    await conn.close();
    await mongod.stop();
  });

  it('registra los 4 modelos de negocio sobre la conexión dada', () => {
    const models = registerModels(conn);
    expect(Object.keys(models).sort()).toEqual([
      'History',
      'ReceiptCounter',
      'Tire',
      'Vehicle',
    ]);
  });

  it('es idempotente: re-registrar devuelve el mismo modelo', () => {
    const a = registerModels(conn);
    const b = registerModels(conn);
    expect(a.Tire).toBe(b.Tire);
  });

  it('liga los modelos a la conexión recibida, no a la global de mongoose', () => {
    const { Tire } = registerModels(conn);
    expect(Tire.db).toBe(conn);
  });

  it('populate Tire->Vehicle resuelve dentro de la misma conexión', async () => {
    const { Tire, Vehicle } = registerModels(conn);
    const v = await Vehicle.create({ brand: 'X', mobile: 'M-pop', licensePlate: 'P-pop' });
    const t = await Tire.create({
      status: 'Nueva',
      code: 9001,
      brand: 'B',
      pattern: 'P',
      size: 'S',
      serialNumber: 'SN-pop',
      vehicle: v._id,
    });
    const found = await Tire.findById(t._id).populate('vehicle');
    expect(found.vehicle.mobile).toBe('M-pop');
  });
});
