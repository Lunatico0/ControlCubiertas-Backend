import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { initBaseConnection, getTenantDb, closeAll } from '../../db/tenantConnections.js';
import { planBorrarCubierta, inspeccionarCubierta, borrarCubiertaConsistente } from '../../../scripts/borrar-cubierta-demo.js';

// La plantilla de la demo pública tenía una cubierta de QA cuyo número de serie es un string de
// prueba XSS. El producto no borra cubiertas (las descarta), así que el script borra a mano y
// tiene que dejar el grafo sano (Bug 3 de BUGS.md): ni history.tire apuntando a una cubierta
// inexistente, ni vehicle.tires[] con la ref. Por eso se niega si la cubierta está montada.

const SERIE = 'QA-<img src=x onerror=alert(1)>';
const BASE = { brand: 'Fate', pattern: 'Liso', size: '295/80 R22.5' };
const PLANTILLA = { _id: 't1', dbName: 'tenant_andes_cargo', isDemoTemplate: true, demoOf: null };
const info = (over = {}) => ({ cubiertas: [{ _id: 'c1', code: 1061, vehicle: null }], vehiculosQueLaListan: 0, historial: 1, correccionesAjenas: 0, ...over });

describe('planBorrarCubierta', () => {
  it('borra la cubierta y su historial cuando está suelta', () => {
    const p = planBorrarCubierta(PLANTILLA, info());
    expect(p).toMatchObject({ ok: true, borra: true, tireId: 'c1', code: 1061, historial: 1 });
  });

  it('es idempotente: si ya no existe, no hay nada que hacer', () => {
    const p = planBorrarCubierta(PLANTILLA, info({ cubiertas: [], historial: 0 }));
    expect(p.ok).toBe(true);
    expect(p.borra).toBe(false);
  });

  it('aborta si la serie matchea más de una cubierta', () => {
    const p = planBorrarCubierta(PLANTILLA, info({ cubiertas: [{ _id: 'a', code: 1 }, { _id: 'b', code: 2 }] }));
    expect(p.ok).toBe(false);
    expect(p.motivo).toMatch(/más de una/i);
  });

  it('aborta si la cubierta está montada o algún vehículo la lista', () => {
    expect(planBorrarCubierta(PLANTILLA, info({ cubiertas: [{ _id: 'c1', code: 1061, vehicle: 'v1' }] })).ok).toBe(false);
    const p = planBorrarCubierta(PLANTILLA, info({ vehiculosQueLaListan: 1 }));
    expect(p.ok).toBe(false);
    expect(p.motivo).toMatch(/montada|vehículo/i);
  });

  it('aborta si historial de OTRA cubierta corrige entradas de esta', () => {
    expect(planBorrarCubierta(PLANTILLA, info({ correccionesAjenas: 1 })).ok).toBe(false);
  });

  it('se niega con un tenant que no es plantilla, un clon o un tenant inexistente', () => {
    expect(planBorrarCubierta({ ...PLANTILLA, isDemoTemplate: false }, info()).motivo).toMatch(/plantilla/i);
    expect(planBorrarCubierta({ ...PLANTILLA, demoOf: 't0' }, info()).ok).toBe(false);
    expect(planBorrarCubierta(null, info()).ok).toBe(false);
  });
});

describe('inspeccionar + borrarCubiertaConsistente (contra Mongo en memoria)', () => {
  let mongod;
  let models;
  let objetivo;
  let otra;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    initBaseConnection(mongod.getUri());
    ({ models } = getTenantDb('tenant_borrar_cubierta'));
    objetivo = await models.Tire.create({ ...BASE, status: 'Nueva', code: 1061, serialNumber: SERIE });
    otra = await models.Tire.create({ ...BASE, status: 'Nueva', code: 1062, serialNumber: 'QAV-1062-0-1' });
    await models.History.create({ tire: objetivo._id, type: 'Alta', status: 'Nueva' });
    await models.History.create({ tire: otra._id, type: 'Alta', status: 'Nueva' });
    await models.Vehicle.create({ brand: 'Scania', mobile: 'M1', licensePlate: 'AAA111', axles: [], tires: [otra._id] });
  });

  afterAll(async () => {
    await closeAll();
    await mongod.stop();
  });

  it('busca por serie EXACTA y cuenta lo que la referencia', async () => {
    const i = await inspeccionarCubierta(models, SERIE);
    expect(i.cubiertas).toHaveLength(1);
    expect(i.historial).toBe(1);
    expect(i.vehiculosQueLaListan).toBe(0);
    expect(i.correccionesAjenas).toBe(0);
    expect((await inspeccionarCubierta(models, 'QA-')).cubiertas).toHaveLength(0);
  });

  it('borra la cubierta y su historial, sin tocar otras cubiertas, historiales ni vehículos', async () => {
    const plan = planBorrarCubierta(PLANTILLA, await inspeccionarCubierta(models, SERIE));
    const r = await borrarCubiertaConsistente(models, plan);

    expect(r).toEqual({ cubiertas: 1, historial: 1 });
    expect(await models.Tire.countDocuments({ _id: objetivo._id })).toBe(0);
    expect(await models.History.countDocuments({ tire: objetivo._id })).toBe(0);
    expect(await models.Tire.countDocuments({ _id: otra._id })).toBe(1);
    expect(await models.History.countDocuments({ tire: otra._id })).toBe(1);
    const v = await models.Vehicle.findOne({ mobile: 'M1' }).lean();
    expect(v.tires.map(String)).toEqual([String(otra._id)]);
  });

  it('segunda corrida: no encuentra nada y no escribe', async () => {
    const plan = planBorrarCubierta(PLANTILLA, await inspeccionarCubierta(models, SERIE));
    expect(plan.borra).toBe(false);
    expect(await borrarCubiertaConsistente(models, plan)).toEqual({ cubiertas: 0, historial: 0 });
  });

  it('nunca borra una cubierta que quedó montada entre el plan y el apply', async () => {
    const montada = await models.Tire.create({ ...BASE, status: 'Nueva', code: 1070, serialNumber: 'X-1', vehicle: new mongoose.Types.ObjectId() });
    const planViejo = { ok: true, borra: true, tireId: montada._id };
    const r = await borrarCubiertaConsistente(models, planViejo);
    expect(r.cubiertas).toBe(0);
    expect(await models.Tire.countDocuments({ _id: montada._id })).toBe(1);
  });
});
