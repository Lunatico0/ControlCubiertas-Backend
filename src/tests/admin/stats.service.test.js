import { MongoMemoryServer } from 'mongodb-memory-server';
import { initBaseConnection, getTenantDb, closeAll } from '../../db/tenantConnections.js';
import { getTenantSummary } from '../../services/stats.service.js';

describe('stats.service (resumen del tenant)', () => {
  let mongod;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    initBaseConnection(mongod.getUri());
    const { Tire, Vehicle } = getTenantDb('tenant_stats').models;
    const conCubierta = await Vehicle.create({ brand: 'X', mobile: 'M1', licensePlate: 'P1', tires: [] });
    await Vehicle.create({ brand: 'Y', mobile: 'M2', licensePlate: 'P2', tires: [] });
    await Tire.create({ status: 'Nueva', code: 1, brand: 'B', pattern: 'P', size: 'S', serialNumber: 'S1', vehicle: conCubierta._id });
    await Tire.create({ status: 'A recapar', code: 2, brand: 'B', pattern: 'P', size: 'S', serialNumber: 'S2' });
    await Tire.create({ status: 'Descartada', code: 3, brand: 'B', pattern: 'P', size: 'S', serialNumber: 'S3' });
  });

  afterAll(async () => {
    await closeAll();
    await mongod.stop();
  });

  it('resume cubiertas por estado, circulación/depósito, vehículos y señales', async () => {
    const s = await getTenantSummary('tenant_stats');
    expect(s.cubiertas.total).toBe(3);
    expect(s.cubiertas.enCirculacion).toBe(1);
    expect(s.cubiertas.enDeposito).toBe(2);
    expect(s.cubiertas.byStatus['A recapar']).toBe(1);
    expect(s.vehiculos.total).toBe(2);
    expect(s.vehiculos.sinCubiertas).toBe(1);
    expect(s.senales.aRecapar).toBe(1);
  });
});
