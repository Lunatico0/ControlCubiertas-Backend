import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { initBaseConnection, getTenantDb, getBaseConnection, closeAll } from '../../db/tenantConnections.js';

// Serverless: una instancia caliente que arrancó con Atlas caído NO puede quedar rota hasta que
// Vercel la recicle. Mongoose no reintenta una conexión INICIAL fallida (sólo reconecta una que
// ya conectó), así que el reintento lo tiene que hacer nuestro código en la request siguiente.
// Episodio real: Sentry TIREOPS-BACKEND-9 y -A, 28/9 y 30/9.

const RAPIDO = { serverSelectionTimeoutMS: 300 };

// Una URI que apunta a un puerto sin Mongo, pero que el test puede "revivir" después.
async function uriCaida() {
  const tmp = await MongoMemoryServer.create();
  const port = tmp.instanceInfo.port;
  await tmp.stop();
  return { port, uri: `mongodb://127.0.0.1:${port}/` };
}

describe('control plane: conexión inicial fallida', () => {
  afterEach(async () => {
    await closeControlPlane();
  });

  it('una falla inicial no envenena los intentos siguientes', async () => {
    await expect(
      connectControlPlane('mongodb://127.0.0.1:1/x?serverSelectionTimeoutMS=300')
    ).rejects.toThrow();

    const mongod = await MongoMemoryServer.create();
    try {
      const models = await connectControlPlane(mongod.getUri());
      expect(Object.keys(models).sort()).toEqual(['Tenant', 'User']);
      expect(getControlModels()).toBe(models);
    } finally {
      await closeControlPlane();
      await mongod.stop();
    }
  });
});

describe('data plane: conexión base inicial fallida', () => {
  let mongod;

  afterAll(async () => {
    await closeAll();
    if (mongod) await mongod.stop();
  });

  it('getTenantDb rearma la conexión base cuando la inicial falló', async () => {
    const { port, uri } = await uriCaida();
    const caida = initBaseConnection(uri, RAPIDO);
    await caida.asPromise().catch(() => {});

    // Atlas vuelve: mismo host y puerto.
    mongod = await MongoMemoryServer.create({ instance: { port } });

    const { models } = getTenantDb('tenant_reintento');
    expect(getBaseConnection()).not.toBe(caida);
    await models.Vehicle.create({ brand: 'B', mobile: 'M-1', licensePlate: 'P-1' });
    expect(await models.Vehicle.countDocuments()).toBe(1);
  });
});
