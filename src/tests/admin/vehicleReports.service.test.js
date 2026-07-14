import { MongoMemoryServer } from 'mongodb-memory-server';
import { initBaseConnection, getTenantDb, closeAll } from '../../db/tenantConnections.js';
import { getVehicleReports } from '../../services/reports.service.js';

// Analítica por vehículo: cuánto "gastan" cubiertas los móviles. La Desasignación guarda el
// km recorrido en el período pero con vehicle:null, así que se atribuye pareando cada
// Asignación (que sí trae el vehículo) con su Desasignación siguiente, por cubierta y en orden.
describe('getVehicleReports (desgaste de cubiertas por vehículo)', () => {
  let mongod;
  let db;
  let seq = 700;
  let d = 0;

  const mkVehicle = (mobile) =>
    db.Vehicle.create({ brand: 'Scania', mobile, licensePlate: `P${++seq}`, axles: [] });
  const mkTire = () =>
    db.Tire.create({ status: 'Nueva', code: ++seq, brand: 'B', pattern: 'P', size: 'S', serialNumber: `SN${seq}` });
  const asignar = (tire, vehicle, kmAlta) =>
    db.History.create({ tire: tire._id, type: 'Asignación', vehicle: vehicle._id, kmAlta, status: 'Nueva', date: new Date(2026, 0, ++d) });
  const desasignar = (tire, kmAlta, kmBaja) =>
    db.History.create({ tire: tire._id, type: 'Desasignación', vehicle: null, kmAlta, kmBaja, km: kmBaja - kmAlta, status: 'Nueva', date: new Date(2026, 0, ++d) });

  const byMobile = (rep, m) => rep.vehicles.find((v) => v.mobile === m);

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    initBaseConnection(mongod.getUri());
    db = getTenantDb('tenant_vehicle_reports').models;

    const v1 = await mkVehicle('Movil 01');
    const v2 = await mkVehicle('Movil 02');
    const a = await mkTire();
    const b = await mkTire();
    const c = await mkTire();

    // Cubierta A: 50.000 km en V1, luego 10.000 km en V2.
    await asignar(a, v1, 0); await desasignar(a, 0, 50000);
    await asignar(a, v2, 50000); await desasignar(a, 50000, 60000);
    // Cubierta B: 30.000 km en V1.
    await asignar(b, v1, 0); await desasignar(b, 0, 30000);
    // Cubierta C: montada en V2, todavía sin bajar (período abierto, no suma km aún).
    c.vehicle = v2._id; await c.save();
    await asignar(c, v2, 0);
  });

  afterAll(async () => {
    await closeAll();
    await mongod.stop();
  });

  it('atribuye el km de cada período al vehículo de su asignación', async () => {
    const rep = await getVehicleReports('tenant_vehicle_reports');
    const m1 = byMobile(rep, 'Movil 01');
    expect(m1.stints).toBe(2);
    expect(m1.kmTotal).toBe(80000);
    expect(m1.avgKmPerStint).toBe(40000);
    expect(m1.tires).toBe(2);
  });

  it('cuenta las cubiertas actualmente montadas (período abierto)', async () => {
    const rep = await getVehicleReports('tenant_vehicle_reports');
    const m2 = byMobile(rep, 'Movil 02');
    expect(m2.stints).toBe(1);
    expect(m2.kmTotal).toBe(10000);
    expect(m2.mounted).toBe(1); // C sigue montada
    expect(m2.tires).toBe(2); // A (bajó) + C (montada)
  });

  it('ordena por km total DESC', async () => {
    const rep = await getVehicleReports('tenant_vehicle_reports');
    expect(rep.vehicles.map((v) => v.mobile)).toEqual(['Movil 01', 'Movil 02']);
  });

  it('tenant sin datos: lista vacía', async () => {
    const rep = await getVehicleReports('tenant_vehicle_empty');
    expect(rep.vehicles).toEqual([]);
  });
});
