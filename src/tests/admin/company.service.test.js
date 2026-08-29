import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { initBaseConnection, getTenantDb, closeAll } from '../../db/tenantConnections.js';
import { getCompany, updateCompany } from '../../services/company.service.js';

describe('company.service (config de empresa + estados configurables)', () => {
  let mongod;
  let tenant;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await connectControlPlane(mongod.getUri());
    initBaseConnection(mongod.getUri()); // data plane, para el chequeo "en uso"
    const { Tenant } = getControlModels();
    tenant = await Tenant.create({ name: 'Acme', dbName: 'tenant_acme_co' });
  });

  afterAll(async () => {
    await closeControlPlane();
    await closeAll();
    await mongod.stop();
  });

  it('getCompany devuelve la empresa con stockStatuses normalizado ({name,role})', async () => {
    const c = await getCompany(tenant._id);
    expect(c.name).toBe('Acme');
    expect(c.dbName).toBe('tenant_acme_co');
    // Default del schema: forma [{name,role}] con initial + discard obligatorios
    expect(Array.isArray(c.stockStatuses)).toBe(true);
    expect(c.stockStatuses.every((s) => typeof s.name === 'string' && typeof s.role === 'string')).toBe(true);
    expect(c.stockStatuses.filter((s) => s.role === 'initial')).toHaveLength(1);
    expect(c.stockStatuses.filter((s) => s.role === 'discard')).toHaveLength(1);
  });

  it('updateCompany actualiza datos y preferencias básicas', async () => {
    const c = await updateCompany(tenant._id, {
      name: 'Acme SA',
      cuit: '30-12345678-9',
      phone: '+54 351 555',
      address: 'Ruta 9 Km 42',
      receiptPrefix: '0002',
      receiptFooter: 'Comprobante interno',
    });
    expect(c.name).toBe('Acme SA');
    expect(c.cuit).toBe('30-12345678-9');
    expect(c.receiptPrefix).toBe('0002');
  });

  it('updateCompany persiste stockStatuses [{name,role,color}] válido (color opcional)', async () => {
    const statuses = [
      { name: 'Nueva', role: 'initial', color: 'var(--st-lime)' },
      { name: '1er Recapado', role: 'stock', color: '#FF8800' },
      { name: '2do Recapado', role: 'stock' }, // sin color → /op usa el automático
      { name: 'A recapar', role: 'recap' },
      { name: 'Descartada', role: 'discard' },
    ];
    const c = await updateCompany(tenant._id, { stockStatuses: statuses });
    expect(c.stockStatuses).toEqual(statuses);
  });

  it('updateCompany RECHAZA un set sin estado descartado', async () => {
    await expect(
      updateCompany(tenant._id, {
        stockStatuses: [
          { name: 'Nueva', role: 'initial' },
          { name: 'Media', role: 'stock' },
        ],
      })
    ).rejects.toThrow(/descart/i);
  });

  it('updateCompany RECHAZA un set sin estado inicial', async () => {
    await expect(
      updateCompany(tenant._id, {
        stockStatuses: [
          { name: 'Media', role: 'stock' },
          { name: 'Baja', role: 'discard' },
        ],
      })
    ).rejects.toThrow(/inicial/i);
  });

  it('updateCompany BLOQUEA eliminar/renombrar un estado en uso por cubiertas', async () => {
    // Sembrar una cubierta con el estado "2do Recapado" en el data plane del tenant
    const { Tire } = getTenantDb('tenant_acme_co').models;
    await Tire.create({ status: '2do Recapado', code: 501, brand: 'B', pattern: 'P', size: 'S', serialNumber: 'SN-501' });

    await expect(
      updateCompany(tenant._id, {
        stockStatuses: [
          { name: 'Nueva', role: 'initial' },
          { name: '1er Recapado', role: 'stock' },
          // quitamos "2do Recapado" que está en uso
          { name: 'A recapar', role: 'recap' },
          { name: 'Descartada', role: 'discard' },
        ],
      })
    ).rejects.toThrow(/2do Recapado/i);
  });

  it('updateCompany PERMITE quitar un estado que no está en uso', async () => {
    const c = await updateCompany(tenant._id, {
      stockStatuses: [
        { name: 'Nueva', role: 'initial' },
        { name: '1er Recapado', role: 'stock' },
        { name: '2do Recapado', role: 'stock' }, // sigue (está en uso)
        { name: 'Descartada', role: 'discard' }, // quitamos "A recapar" (no está en uso)
      ],
    });
    expect(c.stockStatuses.some((s) => s.name === 'A recapar')).toBe(false);
    expect(c.stockStatuses).toHaveLength(4);
  });

  it('updateCompany persiste el diseño del comprobante (receiptDesign)', async () => {
    const c = await updateCompany(tenant._id, {
      receiptDesign: { logoPos: 'center', duplicado: false, accent: '#2358C5' },
    });
    expect(c.receiptDesign.logoPos).toBe('center');
    expect(c.receiptDesign.duplicado).toBe(false);
  });

  it('updateCompany NO permite cambiar dbName ni status (campos del sistema)', async () => {
    const c = await updateCompany(tenant._id, { dbName: 'hackeado', status: 'suspended', name: 'Solo nombre' });
    expect(c.dbName).toBe('tenant_acme_co');
    expect(c.status).toBe('active');
    expect(c.name).toBe('Solo nombre');
  });

  it('updateCompany persiste plateSeparator válido y RECHAZA uno inválido', async () => {
    const ok = await updateCompany(tenant._id, { plateSeparator: '-' });
    expect(ok.plateSeparator).toBe('-');
    const empty = await updateCompany(tenant._id, { plateSeparator: '' });
    expect(empty.plateSeparator).toBe('');
    await expect(updateCompany(tenant._id, { plateSeparator: 'AB' })).rejects.toThrow(/separador/i);
    await expect(updateCompany(tenant._id, { plateSeparator: '4' })).rejects.toThrow(/separador/i);
  });

  it('updateCompany persiste tireCodePrefix válido y RECHAZA uno inválido', async () => {
    const ok = await updateCompany(tenant._id, { tireCodePrefix: 'T-' });
    expect(ok.tireCodePrefix).toBe('T-');
    const empty = await updateCompany(tenant._id, { tireCodePrefix: '' });
    expect(empty.tireCodePrefix).toBe('');
    // > 10 caracteres → rechazo
    await expect(updateCompany(tenant._id, { tireCodePrefix: 'DEMASIADOLARGO123' })).rejects.toThrow(/prefijo/i);
    // caracteres fuera del set permitido (ej. "*") → rechazo
    await expect(updateCompany(tenant._id, { tireCodePrefix: 'A*B' })).rejects.toThrow(/prefijo/i);
  });

  // t2/t125: la impresión automática al ejecutar una acción pasa a ser OPCIONAL por tenant.
  // Default true = comportamiento histórico. Un tenant que no quiere papel en cada movimiento
  // la apaga y reimprime desde el historial cuando lo necesita.
  it('autoPrint arranca en true (comportamiento histórico) y se puede apagar y volver a prender', async () => {
    const { Tenant } = getControlModels();
    const solo = await Tenant.create({ name: 'PrintCo', dbName: 'tenant_printco' });

    expect((await getCompany(solo._id)).autoPrint).toBe(true);

    const apagado = await updateCompany(solo._id, { autoPrint: false });
    expect(apagado.autoPrint).toBe(false);
    expect((await getCompany(solo._id)).autoPrint).toBe(false);

    const prendido = await updateCompany(solo._id, { autoPrint: true });
    expect(prendido.autoPrint).toBe(true);
  });
});
