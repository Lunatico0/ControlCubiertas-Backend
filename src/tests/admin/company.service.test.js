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

  it('updateCompany persiste el diseño del comprobante (receiptDesign)', async () => {
    const design = {
      logo: 'data:image/png;base64,AAAA',
      logoPos: 'center',
      logoSize: 'L',
      showHeader: true,
      accent: '#2358C5',
      font: "'IBM Plex Sans', sans-serif",
      textSize: 'L',
      align: 'center',
      duplicado: false,
      sections: [
        { key: 'cubierta', label: 'Datos de la cubierta', on: true },
        { key: 'orden', label: 'N° de orden', on: false },
      ],
    };
    const c = await updateCompany(tenant._id, { receiptDesign: design });
    expect(c.receiptDesign.logoPos).toBe('center');
    expect(c.receiptDesign.duplicado).toBe(false);
    expect(c.receiptDesign.sections).toHaveLength(2);
    expect(c.receiptDesign.sections[1].on).toBe(false);

    const fetched = await getCompany(tenant._id);
    expect(fetched.receiptDesign.accent).toBe('#2358C5');
  });

  it('updateCompany NO permite cambiar dbName ni status (campos del sistema)', async () => {
    const c = await updateCompany(tenant._id, { dbName: 'hackeado', status: 'suspended', name: 'Solo nombre' });
    expect(c.dbName).toBe('tenant_acme_co');
    expect(c.status).toBe('active');
    expect(c.name).toBe('Solo nombre');
  });
});
