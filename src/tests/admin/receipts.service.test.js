import { MongoMemoryServer } from 'mongodb-memory-server';
import { initBaseConnection, getTenantDb, closeAll } from '../../db/tenantConnections.js';
import { getTenantReceipts } from '../../services/receipts.service.js';

// Histórico de comprobantes = entradas de History que emitieron comprobante
// (receiptNumber != "0000-00000000"), con datos de cubierta + vehículo para la tabla
// y la reimpresión. Lee el data plane del tenant (patrón de stats.service).
describe('receipts.service (histórico de comprobantes del tenant)', () => {
  let mongod;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    initBaseConnection(mongod.getUri());
    const { Tire, Vehicle, History } = getTenantDb('tenant_receipts').models;

    const veh = await Vehicle.create({ brand: 'Scania', mobile: 'M02', licensePlate: 'AB123CD', tires: [] });
    const t14 = await Tire.create({ status: 'Nueva', code: 14, brand: 'Pirelli', pattern: 'P1', size: '295/80 R22.5', serialNumber: 'PI-14' });
    const t20 = await Tire.create({ status: 'Nueva', code: 20, brand: 'Michelin', pattern: 'P2', size: '11R22.5', serialNumber: 'MI-20' });

    await History.create({ tire: t14._id, type: 'Alta', receiptNumber: '0001-00000001', date: new Date('2026-01-01'), editedBy: 'ana', kmAlta: 0 });
    await History.create({ tire: t14._id, type: 'Asignación', receiptNumber: '0001-00000002', date: new Date('2026-02-01'), editedBy: 'ana', vehicle: veh._id, km: 45200 });
    await History.create({ tire: t20._id, type: 'Estado', receiptNumber: '0001-00000003', date: new Date('2026-03-01'), editedBy: 'beto', status: 'A recapar' });
    // Movimiento SIN comprobante emitido → nunca debe aparecer en el histórico.
    await History.create({ tire: t20._id, type: 'Alta', receiptNumber: '0000-00000000', date: new Date('2026-03-05'), editedBy: 'beto', kmAlta: 0 });
  });

  afterAll(async () => {
    await closeAll();
    await mongod.stop();
  });

  it('lista solo los movimientos con comprobante emitido (excluye 0000-00000000)', async () => {
    const { items, total } = await getTenantReceipts('tenant_receipts');
    expect(total).toBe(3);
    expect(items).toHaveLength(3);
    expect(items.every((c) => c.numero !== '0000-00000000')).toBe(true);
  });

  it('ordena por fecha descendente (más nuevo primero) y expone cubierta + vehículo', async () => {
    const { items } = await getTenantReceipts('tenant_receipts');
    expect(items[0].numero).toBe('0001-00000003');
    expect(items[2].numero).toBe('0001-00000001');
    // datos populados para la tabla / reimpresión
    const asignacion = items.find((c) => c.numero === '0001-00000002');
    expect(asignacion.cubierta.code).toBe(14);
    expect(asignacion.cubierta.brand).toBe('Pirelli');
    expect(asignacion.patente).toBe('AB123CD');
    expect(asignacion.usuario).toBe('ana');
  });

  it('filtra por tipo de movimiento', async () => {
    const { items, total } = await getTenantReceipts('tenant_receipts', { type: 'Alta' });
    expect(total).toBe(1);
    expect(items[0].numero).toBe('0001-00000001');
  });

  it('busca por número, código de cubierta o patente (case-insensitive)', async () => {
    expect((await getTenantReceipts('tenant_receipts', { q: '00000002' })).items.map((c) => c.numero)).toEqual(['0001-00000002']);
    expect((await getTenantReceipts('tenant_receipts', { q: '20' })).items.map((c) => c.numero)).toEqual(['0001-00000003']);
    expect((await getTenantReceipts('tenant_receipts', { q: 'ab123' })).items.map((c) => c.numero)).toEqual(['0001-00000002']);
  });

  it('pagina los resultados', async () => {
    const p1 = await getTenantReceipts('tenant_receipts', { page: 1, limit: 2 });
    expect(p1.items).toHaveLength(2);
    expect(p1.total).toBe(3);
    const p2 = await getTenantReceipts('tenant_receipts', { page: 2, limit: 2 });
    expect(p2.items).toHaveLength(1);
    expect(p2.items[0].numero).toBe('0001-00000001');
  });
});
