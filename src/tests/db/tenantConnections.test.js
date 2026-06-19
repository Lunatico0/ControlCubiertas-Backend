import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  initBaseConnection,
  getTenantDb,
  closeAll,
} from '../../db/tenantConnections.js';

describe('tenantConnections — DB-per-tenant', () => {
  let mongod;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    initBaseConnection(mongod.getUri());
  });

  afterAll(async () => {
    await closeAll();
    await mongod.stop();
  });

  it('cachea la conexión por dbName (misma instancia en llamadas repetidas)', () => {
    const a = getTenantDb('tenant_cache');
    const b = getTenantDb('tenant_cache');
    expect(a).toBe(b);
    expect(a.conn).toBe(b.conn);
  });

  it('expone los 4 modelos por tenant', () => {
    const { models } = getTenantDb('tenant_models');
    expect(Object.keys(models).sort()).toEqual([
      'History',
      'ReceiptCounter',
      'Tire',
      'Vehicle',
    ]);
  });

  it('AÍSLA datos entre tenants: lo creado en A no se ve en B', async () => {
    const a = getTenantDb('tenant_alpha');
    const b = getTenantDb('tenant_beta');
    await a.models.Vehicle.create({
      brand: 'A',
      mobile: 'M-iso',
      licensePlate: 'P-iso',
    });
    expect(await a.models.Vehicle.countDocuments()).toBe(1);
    expect(await b.models.Vehicle.countDocuments()).toBe(0);
  });

  it('lanza si la base de conexión no fue inicializada', async () => {
    await closeAll();
    expect(() => getTenantDb('cualquiera')).toThrow();
  });
});
