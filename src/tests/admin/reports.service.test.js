import { MongoMemoryServer } from 'mongodb-memory-server';
import { initBaseConnection, getTenantDb, closeAll } from '../../db/tenantConnections.js';
import { getTenantReports } from '../../services/reports.service.js';

// Ciclo de estados del tenant (mismo shape que devuelve company.getTenantStatuses).
const statuses = [
  { name: 'Nueva', role: 'initial' },
  { name: '1er Recapado', role: 'stock' },
  { name: '2do Recapado', role: 'stock' },
  { name: 'A recapar', role: 'recap' },
  { name: 'Descartada', role: 'discard' },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY_MS);

// Reportes por kilometraje de la flota: agrega Tire (data plane del tenant) y su
// historial de movimientos (History) para vida útil, ranking de marcas y etapas del ciclo.
describe('reports.service (reportes de kilometraje de la flota del tenant)', () => {
  let mongod;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    initBaseConnection(mongod.getUri());
    const { Tire, History } = getTenantDb('tenant_reports').models;

    const t1 = await Tire.create({ code: 1, brand: 'Pirelli', status: 'Nueva', kilometers: 100000, pattern: 'P1', size: '295/80 R22.5', serialNumber: 'PI-1' });
    const t2 = await Tire.create({ code: 2, brand: 'Pirelli', status: 'Descartada', kilometers: 20000, pattern: 'P1', size: '295/80 R22.5', serialNumber: 'PI-2' });
    const t3 = await Tire.create({ code: 3, brand: 'Michelin', status: '1er Recapado', kilometers: 60000, pattern: 'P2', size: '11R22.5', serialNumber: 'MI-3' });
    const t4 = await Tire.create({ code: 4, brand: 'Michelin', status: 'A recapar', kilometers: 40000, pattern: 'P2', size: '11R22.5', serialNumber: 'MI-4' });
    // brand undefined a propósito (dato legacy/manual): el schema lo exige, pero la
    // realidad puede traerlo vacío — se salta la validación solo para armar el fixture.
    await new Tire({ code: 5, status: 'Nueva', kilometers: 10000, pattern: 'P3', size: '10R22.5', serialNumber: 'XX-5' }).save({
      validateBeforeSave: false,
    });
    // Sin kilometraje acumulado: no debe entrar en "analizadas" (total/fleetLife/brands),
    // pero SÍ cuenta en el denominador del discardRate global.
    await Tire.create({ code: 6, brand: 'Pirelli', status: 'Nueva', kilometers: 0, pattern: 'P1', size: '295/80 R22.5', serialNumber: 'PI-6' });

    // Recaps: cambios de estado (o su corrección) hacia un rol 'stock'.
    await History.create({ tire: t2._id, type: 'Estado', status: '1er Recapado', date: daysAgo(100) });
    await History.create({ tire: t2._id, type: 'Corrección-Estado', status: '2do Recapado', date: daysAgo(90) });
    await History.create({ tire: t3._id, type: 'Estado', status: '1er Recapado', date: daysAgo(80) });

    // Desasignaciones por etapa, con fechas distintas para ejercitar el filtro de rango.
    await History.create({ tire: t1._id, type: 'Desasignación', status: 'Nueva', km: 15000, date: daysAgo(30) });
    await History.create({ tire: t1._id, type: 'Desasignación', status: 'Nueva', km: 25000, date: daysAgo(400) });
    await History.create({ tire: t3._id, type: 'Desasignación', status: '1er Recapado', km: 35000, date: daysAgo(200) });
    await History.create({ tire: t4._id, type: 'Desasignación', status: 'A recapar', km: 45000, date: daysAgo(10) });
  });

  afterAll(async () => {
    await closeAll();
    await mongod.stop();
  });

  it('cuenta cubiertas analizadas (kilometers > 0) y calcula la vida útil promedio de la flota', async () => {
    const { total, fleetLife } = await getTenantReports('tenant_reports', statuses);
    expect(total).toBe(5);
    expect(fleetLife).toBe(46000);
  });

  it('calcula el % de descarte sobre TODAS las cubiertas (no solo las analizadas)', async () => {
    const { discardRate } = await getTenantReports('tenant_reports', statuses);
    expect(discardRate).toBe(16.7);
  });

  it('agrupa por marca, ordena por vida útil DESC y calcula recaps + descarte por marca', async () => {
    const { brands } = await getTenantReports('tenant_reports', statuses);
    expect(brands.map((b) => b.name)).toEqual(['Pirelli', 'Michelin', '—']);

    expect(brands.find((b) => b.name === 'Pirelli')).toEqual({ name: 'Pirelli', count: 2, life: 60000, recaps: 1, discardRate: 50 });
    expect(brands.find((b) => b.name === 'Michelin')).toEqual({ name: 'Michelin', count: 2, life: 50000, recaps: 0.5, discardRate: 0 });
    expect(brands.find((b) => b.name === '—')).toEqual({ name: '—', count: 1, life: 10000, recaps: 0, discardRate: 0 });
  });

  it('expone la marca líder (mayor vida útil)', async () => {
    const { leader } = await getTenantReports('tenant_reports', statuses);
    expect(leader).toEqual({ name: 'Pirelli', life: 60000 });
  });

  it('calcula km promedio por etapa del ciclo (excluye discard) sin filtro de rango', async () => {
    const { stages } = await getTenantReports('tenant_reports', statuses, {});
    expect(stages).toEqual([
      { label: 'Nueva', role: 'initial', km: 20000 },
      { label: '1er Recapado', role: 'stock', km: 35000 },
      { label: '2do Recapado', role: 'stock', km: 0 },
      { label: 'A recapar', role: 'recap', km: 45000 },
    ]);
  });

  it('filtra las etapas por rango (12m = últimos 365 días)', async () => {
    const { stages } = await getTenantReports('tenant_reports', statuses, { range: '12m' });
    const byLabel = Object.fromEntries(stages.map((s) => [s.label, s.km]));
    expect(byLabel['Nueva']).toBe(15000); // excluye la desasignación de hace 400 días
    expect(byLabel['1er Recapado']).toBe(35000); // 200 días: entra en 12m
    expect(byLabel['A recapar']).toBe(45000);
  });

  it('filtra las etapas por rango (6m = últimos 180 días)', async () => {
    const { stages } = await getTenantReports('tenant_reports', statuses, { range: '6m' });
    const byLabel = Object.fromEntries(stages.map((s) => [s.label, s.km]));
    expect(byLabel['Nueva']).toBe(15000);
    expect(byLabel['1er Recapado']).toBe(0); // 200 días: queda afuera de 6m
    expect(byLabel['A recapar']).toBe(45000);
  });

  it('sin cubiertas: totales en 0 y leader null', async () => {
    const result = await getTenantReports('tenant_reports_empty', statuses);
    expect(result.total).toBe(0);
    expect(result.fleetLife).toBe(0);
    expect(result.discardRate).toBe(0);
    expect(result.leader).toBeNull();
    expect(result.brands).toEqual([]);
  });
});
