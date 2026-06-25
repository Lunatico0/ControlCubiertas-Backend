import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { getCompany, updateCompany } from '../../services/company.service.js';

describe('company.service (config de empresa)', () => {
  let mongod;
  let tenant;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await connectControlPlane(mongod.getUri());
    const { Tenant } = getControlModels();
    tenant = await Tenant.create({ name: 'Acme', dbName: 'tenant_acme_co' });
  });

  afterAll(async () => {
    await closeControlPlane();
    await mongod.stop();
  });

  it('getCompany devuelve la empresa', async () => {
    const c = await getCompany(tenant._id);
    expect(c.name).toBe('Acme');
    expect(c.dbName).toBe('tenant_acme_co');
  });

  it('updateCompany actualiza datos y preferencias', async () => {
    const c = await updateCompany(tenant._id, {
      name: 'Acme SA',
      cuit: '30-12345678-9',
      phone: '+54 351 555',
      address: 'Ruta 9 Km 42',
      receiptPrefix: '0002',
      receiptFooter: 'Comprobante interno',
      stockStatuses: ['Nueva', 'A recapar'],
    });
    expect(c.name).toBe('Acme SA');
    expect(c.cuit).toBe('30-12345678-9');
    expect(c.receiptPrefix).toBe('0002');
    expect(c.stockStatuses).toEqual(['Nueva', 'A recapar']);
  });

  it('updateCompany NO permite cambiar dbName ni status (campos del sistema)', async () => {
    const c = await updateCompany(tenant._id, { dbName: 'hackeado', status: 'suspended', name: 'Solo nombre' });
    expect(c.dbName).toBe('tenant_acme_co');
    expect(c.status).toBe('active');
    expect(c.name).toBe('Solo nombre');
  });
});
