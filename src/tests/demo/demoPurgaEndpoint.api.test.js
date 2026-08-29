import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../../app.js';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { initBaseConnection, closeAll } from '../../db/tenantConnections.js';
import { crearTenantDemo } from '../../services/demo.service.js';

// El endpoint que dispara la purga de tenants demo vencidos. Lo llama el cron de Vercel, que
// no tiene sesión de usuario: se autentica con un secreto compartido.
//
// Esto BORRA BASES DE DATOS ENTERAS. Sin el secreto no se ejecuta, y si la variable de entorno
// no está configurada el endpoint queda APAGADO en vez de abierto: un endpoint destructivo que
// se cae a "sin auth" porque falta una env var es exactamente cómo se pierde una base.

const DB_PLANTILLA = 'tenant_andes_purga';
let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await connectControlPlane(uri);
  initBaseConnection(uri);
  await getControlModels().Tenant.create({ name: 'Andes Cargo', dbName: DB_PLANTILLA, isDemoTemplate: true });
});

afterAll(async () => {
  await closeControlPlane();
  await closeAll();
  await mongod.stop();
});

afterEach(() => { delete process.env.DEMO_PURGE_SECRET; });

const vencido = async () => {
  const { Tenant } = getControlModels();
  const plantilla = await Tenant.findOne({ dbName: DB_PLANTILLA });
  const demo = await crearTenantDemo(plantilla);
  await Tenant.findByIdAndUpdate(demo._id, { demoExpiresAt: new Date(Date.now() - 1000) });
  return demo;
};

// Vercel Cron invoca con GET y manda `Authorization: Bearer $CRON_SECRET`. Si el endpoint
// aceptara solo POST, el cron devolvería 404 EN SILENCIO y la promesa de las 48 hs quedaría
// rota sin que nadie se entere: la demo se llenaría de tenants muertos. Por eso el verbo del
// cron está cubierto por su propio test.
describe('GET · el verbo con el que realmente llama Vercel Cron', () => {
  it('purga igual que el POST', async () => {
    process.env.DEMO_PURGE_SECRET = 'secreto-del-cron';
    const demo = await vencido();

    const res = await request(app).get('/api/admin/demo/purge').set('Authorization', 'Bearer secreto-del-cron');

    expect(res.status).toBe(200);
    expect(await getControlModels().Tenant.findById(demo._id)).toBeNull();
  });

  it('acepta CRON_SECRET, que es la variable que Vercel setea sola', async () => {
    process.env.CRON_SECRET = 'el-de-vercel';
    const demo = await vencido();

    const res = await request(app).get('/api/admin/demo/purge').set('Authorization', 'Bearer el-de-vercel');
    delete process.env.CRON_SECRET;

    expect(res.status).toBe(200);
    expect(await getControlModels().Tenant.findById(demo._id)).toBeNull();
  });
});

describe('POST /api/admin/demo/purge', () => {
  it('sin DEMO_PURGE_SECRET configurado, el endpoint está APAGADO', async () => {
    const res = await request(app).post('/api/admin/demo/purge');

    expect(res.status).toBe(404);
  });

  it('con el secreto configurado pero sin mandarlo, rechaza', async () => {
    process.env.DEMO_PURGE_SECRET = 'secreto-del-cron';

    const res = await request(app).post('/api/admin/demo/purge');

    expect(res.status).toBe(401);
  });

  it('con un secreto equivocado, rechaza', async () => {
    process.env.DEMO_PURGE_SECRET = 'secreto-del-cron';

    const res = await request(app).post('/api/admin/demo/purge').set('Authorization', 'Bearer otro');

    expect(res.status).toBe(401);
  });

  it('con el secreto correcto, purga y reporta qué borró', async () => {
    process.env.DEMO_PURGE_SECRET = 'secreto-del-cron';
    const demo = await vencido();

    const res = await request(app).post('/api/admin/demo/purge').set('Authorization', 'Bearer secreto-del-cron');

    expect(res.status).toBe(200);
    expect(res.body.borrados).toBeGreaterThanOrEqual(1);
    expect(await getControlModels().Tenant.findById(demo._id)).toBeNull();
  });

  it('no borra la plantilla ni deja de existir después de purgar', async () => {
    process.env.DEMO_PURGE_SECRET = 'secreto-del-cron';

    await request(app).post('/api/admin/demo/purge').set('Authorization', 'Bearer secreto-del-cron');

    const plantilla = await getControlModels().Tenant.findOne({ dbName: DB_PLANTILLA });
    expect(plantilla).not.toBeNull();
  });
});
