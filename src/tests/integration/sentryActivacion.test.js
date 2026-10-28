// Observabilidad del backend: cuándo se prende Sentry (I1) y qué le llega (I2).
//
// I1. Sentry se prendía con DSN en CUALQUIER entorno salvo test: el backend local de QA
//     reportaba al mismo proyecto que producción y cada corrida disparaba alertas por mail.
//     Criterio nuevo, el mismo que el front (main.jsx): sólo en producción, o a pedido con
//     SENTRY_DEV=true para depurar el propio Sentry. En tests, nunca.
//
// I2. El handler de Sentry estaba montado ANTES de la normalización de E11000/CastError. Un
//     E11000 no trae `status`, así que Sentry lo tomaba como 500 no manejado (handled:no) aunque
//     el cliente recibiera un 400. Una alerta falsa por cada duplicado tapa las reales.
//
// @sentry/node se reemplaza por un doble: lo que interesa es el contrato (qué error recibe el
// handler y si decide capturarlo), no mandar nada a la red.
import { jest } from '@jest/globals';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import mongoose from 'mongoose';
import { sentryHabilitado } from '../../utils/sentryEnabled.js';

// Réplica del filtro por default de @sentry/core (defaultShouldHandleError): si app.js no pasa
// el suyo, el doble decide igual que el SDK real.
const filtroPorDefault = (err) => {
  const status = err.status || err.statusCode || err.status_code || err.output?.statusCode;
  return (status ? parseInt(status, 10) : 500) >= 500;
};

const vistos = [];
const init = jest.fn();
jest.unstable_mockModule('@sentry/node', () => ({
  init,
  setupExpressErrorHandler: (app, options) => {
    const debeCapturar = options?.shouldHandleError || filtroPorDefault;
    app.use((err, req, res, next) => {
      vistos.push({ err, capturado: debeCapturar(err) });
      next(err);
    });
  },
}));

const DSN = 'https://publica@o0.ingest.sentry.io/0';

describe('I1 · sentryHabilitado decide por entorno', () => {
  it.each([
    ['producción por NODE_ENV', { SENTRY_DSN: DSN, NODE_ENV: 'production' }, true],
    ['producción por VERCEL_ENV', { SENTRY_DSN: DSN, VERCEL_ENV: 'production' }, true],
    ['depuración explícita en local', { SENTRY_DSN: DSN, NODE_ENV: 'development', SENTRY_DEV: 'true' }, true],
    ['backend local sin NODE_ENV (npm run dev)', { SENTRY_DSN: DSN }, false],
    ['development', { SENTRY_DSN: DSN, NODE_ENV: 'development' }, false],
    ['preview de Vercel sin NODE_ENV de producción', { SENTRY_DSN: DSN, VERCEL_ENV: 'preview' }, false],
    ['SENTRY_DEV con otro valor que "true"', { SENTRY_DSN: DSN, NODE_ENV: 'development', SENTRY_DEV: '1' }, false],
    ['tests, aunque diga producción en Vercel', { SENTRY_DSN: DSN, NODE_ENV: 'test', VERCEL_ENV: 'production' }, false],
    ['tests, aunque pidan depurar', { SENTRY_DSN: DSN, NODE_ENV: 'test', SENTRY_DEV: 'true' }, false],
    ['producción sin DSN', { NODE_ENV: 'production' }, false],
  ])('%s', (_caso, env, esperado) => {
    expect(sentryHabilitado(env)).toBe(esperado);
  });
});

describe('I1 · instrument.js usa ese criterio', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
    init.mockClear();
  });

  it('con DSN en development NO inicializa Sentry', async () => {
    Object.assign(process.env, { SENTRY_DSN: DSN, NODE_ENV: 'development' });
    delete process.env.SENTRY_DEV;
    delete process.env.VERCEL_ENV;
    const { sentryEnabled } = await import(`../../instrument.js?dev=${Math.random()}`);
    expect(sentryEnabled).toBe(false);
    expect(init).not.toHaveBeenCalled();
  });

  it('con DSN en producción sí lo inicializa', async () => {
    Object.assign(process.env, { SENTRY_DSN: DSN, NODE_ENV: 'production' });
    const { sentryEnabled } = await import(`../../instrument.js?prod=${Math.random()}`);
    expect(sentryEnabled).toBe(true);
    expect(init).toHaveBeenCalledWith(expect.objectContaining({ dsn: DSN }));
  });
});

describe('I2 · con Sentry activo, sólo le llegan las fallas del servidor', () => {
  const DB_NAME = 'tenant_sentry_activo';
  const original = { ...process.env };
  let mongod;
  let app;
  let auth;
  let db;
  let closeControlPlane;
  let closeAll;

  beforeAll(async () => {
    // El entorno se fija ANTES de importar la app: instrument.js decide al cargarse.
    Object.assign(process.env, { SENTRY_DSN: DSN, NODE_ENV: 'production', JWT_ACCESS_SECRET: 'test-access-secret' });

    const controlPlane = await import('../../db/controlPlane.js');
    const tenantConnections = await import('../../db/tenantConnections.js');
    const { registerModels } = await import('../../db/registerModels.js');
    const { createTenantAndToken } = await import('../helpers/tenantAuth.js');
    ({ closeControlPlane } = controlPlane);
    ({ closeAll } = tenantConnections);

    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    await controlPlane.connectControlPlane(uri);
    tenantConnections.initBaseConnection(uri);
    await controlPlane.getControlModels().User.init();
    ({ auth } = await createTenantAndToken({ name: 'Sentry SA', dbName: DB_NAME }));
    db = registerModels(tenantConnections.getTenantDb(DB_NAME));

    app = (await import(`../../app.js?sentry=${Math.random()}`)).default;
  });

  afterAll(async () => {
    process.env = { ...original };
    await closeControlPlane();
    await closeAll();
    await mongod.stop();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    vistos.length = 0;
  });

  const listarVehiculosFallando = (err) => {
    jest.spyOn(db.Vehicle, 'find').mockImplementation(() => ({ populate: () => Promise.reject(err) }));
    return request(app).get('/api/vehicles').set(auth);
  };

  it('un E11000 real del driver llega normalizado (400) y no se captura', async () => {
    await db.Tire.init();
    await db.Tire.collection.insertOne({ code: 8101 });
    const err = await db.Tire.collection.insertOne({ code: 8101 }).catch((e) => e);
    expect(err.code).toBe(11000);

    const res = await listarVehiculosFallando(err);

    expect(res.status).toBe(400);
    expect(vistos).toHaveLength(1);
    expect(vistos[0].err.status).toBe(400);
    expect(vistos[0].capturado).toBe(false);
  });

  it('un CastError llega normalizado (400) y no se captura', async () => {
    const res = await listarVehiculosFallando(new mongoose.Error.CastError('ObjectId', 'no-es-un-id', '_id'));

    expect(res.status).toBe(400);
    expect(vistos).toHaveLength(1);
    expect(vistos[0].capturado).toBe(false);
  });

  it('un error inesperado sí se captura, y el cliente sigue recibiendo el mensaje genérico', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await listarVehiculosFallando(new Error('se cayó el cluster'));

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Error interno del servidor. Volvé a intentar en unos minutos.');
    expect(vistos).toHaveLength(1);
    expect(vistos[0].capturado).toBe(true);
  });
});
