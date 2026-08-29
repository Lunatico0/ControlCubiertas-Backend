import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { initBaseConnection, closeAll, getTenantDb } from '../../db/tenantConnections.js';
import { registerModels } from '../../db/registerModels.js';
import { crearTenantDemo, purgarDemosVencidos, VENTANA_DEMO_MS } from '../../services/demo.service.js';

// Demo de Andes Cargo: un tenant EFÍMERO por visitante.
//
// El recuadro del login promete un entorno de prueba que se restaura solo. Antes no lo hacía:
// lo que cargaba un prospecto entraba a la base de Andes Cargo y se quedaba ahí para siempre,
// así que la leyenda era falsa y la demo se ensuciaba sola con el uso.
//
// El modelo elegido (28/8) es clonar: al loguearse con las credenciales demo, el backend crea
// un tenant DESCARTABLE a partir de la plantilla y firma el token contra ese. El prospecto usa
// el backend REAL —mismas validaciones, mismos correlativos, mismo historial derivado— sobre
// datos que son suyos y que se borran a las 48 hs. Dos visitantes simultáneos no se pisan.
//
// La alternativa era simular las escrituras en el navegador, que es lo que decía la leyenda
// original. Se descartó: obligaba a reimplementar en el browser el recálculo de estado, los
// correlativos y los guards por rol, y la demo habría mostrado un comportamiento que el
// producto real no tiene.

let mongod;
let plantillaId;

const DB_PLANTILLA = 'tenant_andes_cargo_demo';

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await connectControlPlane(uri);
  initBaseConnection(uri);

  const { Tenant } = getControlModels();
  const plantilla = await Tenant.create({
    name: 'Andes Cargo',
    dbName: DB_PLANTILLA,
    isDemoTemplate: true,
    plateSeparator: '-',
    tireCodePrefix: 'AC-',
    autoPrint: false,
    stockStatuses: [
      { name: 'Nueva', role: 'initial' },
      { name: 'Media', role: 'stock' },
      { name: 'A recapar', role: 'recap' },
      { name: 'Baja', role: 'discard' },
    ],
  });
  plantillaId = plantilla._id;

  // Datos de negocio de la plantilla.
  const db = registerModels(getTenantDb(DB_PLANTILLA));
  const veh = await db.Vehicle.create({
    brand: 'Scania', mobile: 'AC-01', licensePlate: 'AAA111', axles: [{ type: 'simple' }], tires: [],
  });
  const tire = await db.Tire.create({
    status: 'Nueva', code: 1, brand: 'Michelin', pattern: 'XZA', size: '295/80R22.5',
    serialNumber: 'SN1', vehicle: veh._id, position: 'E1-I',
  });
  await db.History.create({ tire: tire._id, type: 'Alta', status: 'Nueva', date: new Date() });
  await db.ReceiptCounter.create({ pointOfSale: 1, currentNumber: 17 });
});

afterAll(async () => {
  await closeControlPlane();
  await closeAll();
  await mongod.stop();
});

describe('crearTenantDemo · clona la plantilla en un tenant descartable', () => {
  it('crea un tenant nuevo, distinto de la plantilla', async () => {
    const { Tenant } = getControlModels();
    const plantilla = await Tenant.findById(plantillaId);

    const demo = await crearTenantDemo(plantilla);

    expect(String(demo._id)).not.toBe(String(plantillaId));
    expect(demo.dbName).not.toBe(DB_PLANTILLA);
    expect(demo.dbName).toMatch(/^tenant_demo_/);
  });

  it('el clon NO es a su vez una plantilla: no se puede clonar en cadena', async () => {
    const { Tenant } = getControlModels();
    const demo = await crearTenantDemo(await Tenant.findById(plantillaId));

    expect(demo.isDemoTemplate).toBeFalsy();
    expect(String(demo.demoOf)).toBe(String(plantillaId));
  });

  it('vence a las 48 hs', async () => {
    const { Tenant } = getControlModels();
    const antes = Date.now();

    const demo = await crearTenantDemo(await Tenant.findById(plantillaId));

    const margen = demo.demoExpiresAt.getTime() - antes;
    expect(margen).toBeGreaterThan(VENTANA_DEMO_MS - 5000);
    expect(margen).toBeLessThanOrEqual(VENTANA_DEMO_MS + 5000);
    expect(VENTANA_DEMO_MS).toBe(48 * 60 * 60 * 1000);
  });

  it('copia la CONFIG del tenant: el prospecto ve la empresa configurada, no los defaults', async () => {
    const { Tenant } = getControlModels();
    const demo = await crearTenantDemo(await Tenant.findById(plantillaId));

    expect(demo.plateSeparator).toBe('-');
    expect(demo.tireCodePrefix).toBe('AC-');
    expect(demo.autoPrint).toBe(false);
    expect(demo.stockStatuses.map((s) => s.name)).toEqual(['Nueva', 'Media', 'A recapar', 'Baja']);
  });

  it('copia los DATOS de negocio, con sus relaciones intactas', async () => {
    const { Tenant } = getControlModels();
    const demo = await crearTenantDemo(await Tenant.findById(plantillaId));
    const db = registerModels(getTenantDb(demo.dbName));

    const [tires, vehicles, histories] = await Promise.all([
      db.Tire.find().populate('vehicle'),
      db.Vehicle.find(),
      db.History.find(),
    ]);

    expect(vehicles).toHaveLength(1);
    expect(tires).toHaveLength(1);
    expect(histories).toHaveLength(1);
    // La ref sobrevive a la copia: se conservan los _id originales.
    expect(tires[0].vehicle.mobile).toBe('AC-01');
    expect(String(histories[0].tire)).toBe(String(tires[0]._id));
  });

  it('copia el contador de comprobantes: el correlativo sigue donde estaba', async () => {
    const { Tenant } = getControlModels();
    const demo = await crearTenantDemo(await Tenant.findById(plantillaId));
    const db = registerModels(getTenantDb(demo.dbName));

    const contador = await db.ReceiptCounter.findOne({ pointOfSale: 1 });
    expect(contador.currentNumber).toBe(17);
  });

  it('dos visitantes NO se pisan: cada uno escribe en su propia base', async () => {
    const { Tenant } = getControlModels();
    const plantilla = await Tenant.findById(plantillaId);
    const unoT = await crearTenantDemo(plantilla);
    const dosT = await crearTenantDemo(plantilla);

    const uno = registerModels(getTenantDb(unoT.dbName));
    const dos = registerModels(getTenantDb(dosT.dbName));

    await uno.Vehicle.create({ brand: 'X', mobile: 'SOLO-UNO', licensePlate: 'BBB222', axles: [], tires: [] });

    expect(await uno.Vehicle.countDocuments()).toBe(2);
    expect(await dos.Vehicle.countDocuments()).toBe(1); // el suyo quedó intacto
  });

  it('la PLANTILLA nunca se ensucia con lo que carga un visitante', async () => {
    const { Tenant } = getControlModels();
    const demo = await crearTenantDemo(await Tenant.findById(plantillaId));
    const db = registerModels(getTenantDb(demo.dbName));

    await db.Vehicle.create({ brand: 'X', mobile: 'BASURA', licensePlate: 'CCC333', axles: [], tires: [] });

    const plantillaDb = registerModels(getTenantDb(DB_PLANTILLA));
    expect(await plantillaDb.Vehicle.countDocuments()).toBe(1);
  });
});

describe('purgarDemosVencidos · la limpieza que hace verdadera la leyenda', () => {
  it('borra el tenant vencido y su base entera', async () => {
    const { Tenant } = getControlModels();
    const demo = await crearTenantDemo(await Tenant.findById(plantillaId));
    await Tenant.findByIdAndUpdate(demo._id, { demoExpiresAt: new Date(Date.now() - 1000) });

    const { borrados } = await purgarDemosVencidos();

    expect(borrados).toBeGreaterThanOrEqual(1);
    expect(await Tenant.findById(demo._id)).toBeNull();
    const db = registerModels(getTenantDb(demo.dbName));
    expect(await db.Vehicle.countDocuments()).toBe(0);
  });

  it('NO toca un demo que todavía está vivo', async () => {
    const { Tenant } = getControlModels();
    const vivo = await crearTenantDemo(await Tenant.findById(plantillaId));

    await purgarDemosVencidos();

    expect(await Tenant.findById(vivo._id)).not.toBeNull();
  });

  it('NO toca la plantilla, ni aunque no tenga fecha de vencimiento', async () => {
    const { Tenant } = getControlModels();

    await purgarDemosVencidos();

    const plantilla = await Tenant.findById(plantillaId);
    expect(plantilla).not.toBeNull();
    expect(plantilla.isDemoTemplate).toBe(true);
  });

  it('NO toca un tenant REAL de un cliente que paga', async () => {
    const { Tenant } = getControlModels();
    const real = await Tenant.create({ name: 'Cliente Real', dbName: 'tenant_cliente_real' });

    await purgarDemosVencidos();

    expect(await Tenant.findById(real._id)).not.toBeNull();
  });
});
