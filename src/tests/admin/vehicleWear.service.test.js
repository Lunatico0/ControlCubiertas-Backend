import { MongoMemoryServer } from 'mongodb-memory-server';
import { initBaseConnection, getTenantDb, closeAll } from '../../db/tenantConnections.js';
import { getVehicleWear } from '../../services/reports.service.js';

// Desgaste POR POSICIÓN de un camión: km acumulado en cada posición del eje a lo largo de la
// ventana. Se pairea cada Asignación (que ahora guarda la posición) con su Desasignación (km),
// atribuyendo el km a esa posición del vehículo. La cubierta actual de cada posición se toma del
// estado vigente (para la etiqueta de recapado).
describe('getVehicleWear (desgaste por posición de un camión)', () => {
  let mongod;
  let db;
  let seq = 900;
  let d = 0;
  let vId;

  const statuses = [
    { name: 'Nueva', role: 'initial' },
    { name: '1er Recapado', role: 'stock' },
    { name: '2do Recapado', role: 'stock' },
    { name: 'A recapar', role: 'recap' },
    { name: 'Descartada', role: 'discard' },
  ];

  const mkTire = (status = 'Nueva') =>
    db.Tire.create({ status, code: ++seq, brand: 'B', pattern: 'P', size: 'S', serialNumber: `SN${seq}` });
  const asignar = (tire, kmAlta, position) =>
    db.History.create({ tire: tire._id, type: 'Asignación', vehicle: vId, position, kmAlta, status: 'Nueva', date: new Date(2026, 0, ++d) });
  const desasignar = (tire, kmAlta, kmBaja) =>
    db.History.create({ tire: tire._id, type: 'Desasignación', vehicle: null, kmAlta, kmBaja, km: kmBaja - kmAlta, status: 'Nueva', date: new Date(2026, 0, ++d) });
  const pos = (rep, code) => rep.positions.find((p) => p.code === code);

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    initBaseConnection(mongod.getUri());
    db = getTenantDb('tenant_vehicle_wear').models;

    const v = await db.Vehicle.create({ brand: 'Scania', mobile: 'Movil W', licensePlate: 'PW1', axles: [{ type: 'simple' }, { type: 'dual' }] });
    vId = v._id;

    // Cubierta A: dos períodos en E1-I → 40.000 + 20.000 = 60.000 km en esa posición.
    const a = await mkTire();
    await asignar(a, 0, 'E1-I'); await desasignar(a, 0, 40000);
    await asignar(a, 40000, 'E1-I'); await desasignar(a, 40000, 60000);
    // Cubierta B: un período en E2-DE → 10.000 km.
    const b = await mkTire();
    await asignar(b, 0, 'E2-DE'); await desasignar(b, 0, 10000);
    // Cubierta C: montada AHORA en E1-D (período abierto, 0 km acumulado ahí todavía).
    const c = await mkTire('1er Recapado');
    c.vehicle = vId; c.position = 'E1-D'; await c.save();
    await asignar(c, 0, 'E1-D');
    global.__cCode = c.code;
  });

  afterAll(async () => {
    await closeAll();
    await mongod.stop();
  });

  it('acumula el km por posición pareando asignación (con posición) y desasignación', async () => {
    const rep = await getVehicleWear('tenant_vehicle_wear', String(vId), statuses);
    expect(pos(rep, 'E1-I').km).toBe(60000);
    expect(pos(rep, 'E2-DE').km).toBe(10000);
    expect(pos(rep, 'E2-II').km).toBe(0);
    expect(rep.maxPosKm).toBe(60000);
  });

  it('expone todas las posiciones del esquema de ejes en orden', async () => {
    const rep = await getVehicleWear('tenant_vehicle_wear', String(vId), statuses);
    expect(rep.positions.map((p) => p.code)).toEqual(['E1-I', 'E1-D', 'E2-IE', 'E2-II', 'E2-DI', 'E2-DE']);
    expect(pos(rep, 'E1-I').axle).toBe(1);
    expect(pos(rep, 'E2-DE').axle).toBe(2);
  });

  it('agrega km por eje (suma de sus posiciones)', async () => {
    const rep = await getVehicleWear('tenant_vehicle_wear', String(vId), statuses);
    const axle1 = rep.axles.find((a) => a.axle === 1);
    const axle2 = rep.axles.find((a) => a.axle === 2);
    expect(axle1.km).toBe(60000); // E1-I 60000 + E1-D 0
    expect(axle2.km).toBe(10000); // E2-DE 10000 + resto 0
  });

  it('marca la cubierta montada actual en cada posición con su recapado', async () => {
    const rep = await getVehicleWear('tenant_vehicle_wear', String(vId), statuses);
    const e1d = pos(rep, 'E1-D');
    expect(e1d.current).toMatchObject({ code: global.__cCode, role: 'stock', level: 1 });
    expect(pos(rep, 'E2-II').current).toBeNull();
  });
});
