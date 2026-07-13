import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { registerModels } from '../../db/registerModels.js';
import tireService from '../../services/tire.service.js';

// El listado (getAll) expone recapLevel: el nivel de recapado de cada cubierta = posición en
// la escalera (Nueva=0, 1er=1, 2do=2, ...). Para las cubiertas fuera de la escalera (A recapar
// / Descartada) el status actual no dice con qué recapado salieron, así que se toma el máximo
// nivel de escalera alcanzado en el historial. Alimenta los pips de la card en /op.
describe('getAll → recapLevel', () => {
  let mongod;
  let conn;
  let db;
  let seq = 400;

  // Catálogo del tenant (misma forma que devuelve company.getTenantStatuses).
  const statuses = [
    { name: 'Nueva', role: 'initial' },
    { name: '1er Recapado', role: 'stock' },
    { name: '2do Recapado', role: 'stock' },
    { name: '3er Recapado', role: 'stock' },
    { name: 'A recapar', role: 'recap' },
    { name: 'Descartada', role: 'discard' },
  ];

  const mkTire = (status) =>
    db.Tire.create({ status, code: ++seq, brand: 'B', pattern: 'P', size: 'S', serialNumber: `SN${seq}` });

  const hist = (tire, status) => db.History.create({ tire: tire._id, type: 'Estado', status });

  const byCode = (tires, code) => tires.find((t) => t.code === code);

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

  it('usa la posición en la escalera para una cubierta en stock', async () => {
    const t = await mkTire('2do Recapado');
    const tires = await tireService.getAll(db, statuses);
    expect(byCode(tires, t.code).recapLevel).toBe(2);
  });

  it('una Nueva tiene recapLevel 0', async () => {
    const t = await mkTire('Nueva');
    const tires = await tireService.getAll(db, statuses);
    expect(byCode(tires, t.code).recapLevel).toBe(0);
  });

  it('una Descartada usa el máximo recapado alcanzado en el historial', async () => {
    const t = await mkTire('Descartada');
    await hist(t, 'Nueva');
    await hist(t, '1er Recapado');
    await hist(t, '2do Recapado');
    await hist(t, '3er Recapado');
    await hist(t, 'Descartada');
    const tires = await tireService.getAll(db, statuses);
    expect(byCode(tires, t.code).recapLevel).toBe(3);
  });

  it('una Descartada sin recapados (solo Nueva) tiene recapLevel 0', async () => {
    const t = await mkTire('Descartada');
    await hist(t, 'Nueva');
    await hist(t, 'Descartada');
    const tires = await tireService.getAll(db, statuses);
    expect(byCode(tires, t.code).recapLevel).toBe(0);
  });

  it('sin catálogo no rompe (recapLevel 0)', async () => {
    const t = await mkTire('Nueva');
    const tires = await tireService.getAll(db);
    expect(byCode(tires, t.code).recapLevel).toBe(0);
  });
});
