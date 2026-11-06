import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { initBaseConnection, closeAll, getTenantDb, getBaseConnection } from '../../db/tenantConnections.js';
import { crearTenantDemo, purgarDemosVencidos } from '../../services/demo.service.js';

// Bases huérfanas de la demo (5/11): en Atlas quedaron 3 `tenant_demo_*` vacías, con sus 5
// colecciones e índices, y sin registro de Tenant. La purga las había borrado, pero en una
// invocación en frío (el cron, sin la base en cache) `getTenantDb` compilaba los modelos para
// poder llamar a dropDatabase, y el `model.init()` de Mongoose (autoCreate + autoIndex) corría
// en paralelo con el drop y volvía a crear la base vacía. Después se borraba el Tenant y la
// base quedaba sin nadie que la nombre, invisible para la purga.
//
// Lo que se prueba: que el drop en frío no deja la base viva, y que la purga levanta las
// huérfanas que ya existen (las de antes del fix, o las que deje cualquier otro camino).

let mongod;
let uri;
let plantilla;

const DB_PLANTILLA = 'tenant_plantilla_huerfanas';

const nombresDeBases = async () => {
  const { databases } = await getBaseConnection().getClient().db('admin').admin().listDatabases({ nameOnly: true });
  return databases.map((d) => d.name);
};

// Margen para que termine cualquier createCollection / createIndexes que haya quedado en vuelo.
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  uri = mongod.getUri();
  await connectControlPlane(uri);
  initBaseConnection(uri);

  const { Tenant } = getControlModels();
  plantilla = await Tenant.create({ name: 'Andes Cargo', dbName: DB_PLANTILLA, isDemoTemplate: true });
  await getTenantDb(DB_PLANTILLA).models.Vehicle.create({
    brand: 'Scania', mobile: 'AC-01', licensePlate: 'AAA111', axles: [{ type: 'simple' }], tires: [],
  });
});

afterAll(async () => {
  await closeControlPlane();
  await closeAll();
  await mongod.stop();
});

describe('purgarDemosVencidos · no deja bases huérfanas', () => {
  it('en frío (otra instancia, sin la base en cache) la base vencida desaparece del cluster', async () => {
    const { Tenant } = getControlModels();
    const demo = await crearTenantDemo(plantilla);
    await Tenant.findByIdAndUpdate(demo._id, { demoExpiresAt: new Date(Date.now() - 1000) });
    expect(await nombresDeBases()).toContain(demo.dbName);

    // Cold start: conexión base nueva y cache vacía, como la invocación del cron.
    await closeAll();
    initBaseConnection(uri);
    await getBaseConnection().asPromise();

    await purgarDemosVencidos();
    await esperar(1000);

    expect(await Tenant.findById(demo._id)).toBeNull();
    expect(await nombresDeBases()).not.toContain(demo.dbName);
  });

  it('red de seguridad: dropea las tenant_demo_ sin Tenant y no toca nada más', async () => {
    const { Tenant } = getControlModels();
    const cliente = getBaseConnection().getClient();

    // Huérfana como las de Atlas: nombre de clon efímero, sin registro en el control plane.
    const HUERFANA = 'tenant_demo_0000000000aa';
    await cliente.db(HUERFANA).collection('vehicles').insertOne({ licensePlate: 'ZZZ999' });
    // Base sin Tenant pero que NO es un clon de la demo: nunca se toca.
    const AJENA = 'tenant_cliente_sin_registro';
    await cliente.db(AJENA).collection('vehicles').insertOne({ licensePlate: 'YYY888' });
    // Demo vivo, con su Tenant: tampoco se toca.
    const vivo = await crearTenantDemo(plantilla);

    const res = await purgarDemosVencidos();
    await esperar(500);

    const bases = await nombresDeBases();
    expect(bases).not.toContain(HUERFANA);
    expect(res.huerfanas).toEqual([HUERFANA]);
    expect(bases).toContain(AJENA);
    expect(bases).toContain(vivo.dbName);
    expect(bases).toContain(DB_PLANTILLA);
    expect(await Tenant.findById(vivo._id)).not.toBeNull();
  });
});
