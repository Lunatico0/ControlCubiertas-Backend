import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { registerModels } from '../../db/registerModels.js';
import { migrateAxles } from '../../utils/migrateAxles.js';

// A4: migración de un tenant existente al modelo de ejes. NO inventa disposiciones
// (decisión: el admin configura los ejes desde la UI). Solo normaliza defaults
// (kilometers/position) en docs legacy y reporta qué falta configurar. Idempotente.
// Los docs "legacy" se insertan con el driver nativo (collection.insertOne) para
// saltear los defaults del schema y simular datos previos a esta feature.
describe('migrateAxles(db) — migración no destructiva al modelo de ejes', () => {
  let mongod;
  let conn;
  let db;
  let v1Id;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    conn = mongoose.createConnection(mongod.getUri());
    await conn.asPromise();
    db = registerModels(conn);

    // Vehículo legacy: sin axles, sin kilometers.
    const v1 = await db.Vehicle.collection.insertOne({ brand: 'Scania', mobile: 'M1', licensePlate: 'AAA111' });
    v1Id = v1.insertedId;
    // Vehículo moderno: ya con ejes y km.
    await db.Vehicle.create({ brand: 'Ford', mobile: 'M2', licensePlate: 'AAA222', kilometers: 8000, axles: [{ type: 'simple' }, { type: 'dual' }] });

    // Cubierta montada legacy (sin position) + cubierta en depósito legacy (sin position).
    await db.Tire.collection.insertOne({ status: 'Nueva', code: 1, brand: 'B', pattern: 'P', size: 'S', serialNumber: 'SN1', vehicle: v1Id });
    await db.Tire.collection.insertOne({ status: 'Nueva', code: 2, brand: 'B', pattern: 'P', size: 'S', serialNumber: 'SN2' });
  });

  afterAll(async () => {
    await conn.close();
    await mongod.stop();
  });

  it('normaliza defaults y reporta sin inventar ejes', async () => {
    const report = await migrateAxles(db);

    expect(report.kilometersBackfilled).toBe(1); // solo el legacy V1
    expect(report.positionsBackfilled).toBe(2); // ambas cubiertas legacy
    expect(report.vehiclesTotal).toBe(2);
    expect(report.vehiclesWithoutAxles).toBe(1); // V1 queda por configurar
    expect(report.tiresMountedWithoutPosition).toBe(1); // la montada en V1

    // NO se inventaron ejes: V1 sigue sin disposición.
    const v1 = await db.Vehicle.findById(v1Id);
    expect(v1.axles).toHaveLength(0);
    expect(v1.kilometers).toBe(0);
  });

  it('es idempotente: una segunda corrida no modifica nada', async () => {
    const report = await migrateAxles(db);
    expect(report.kilometersBackfilled).toBe(0);
    expect(report.positionsBackfilled).toBe(0);
  });
});
