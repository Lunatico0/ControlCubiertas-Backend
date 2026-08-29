// Contrato de errores de la API.
//
// Dos reglas que valen para TODA la API multi-tenant:
//   1. Un input inválido responde 4xx, nunca 5xx ni una request que queda colgada.
//   2. El cuerpo del error nunca filtra detalles internos — y menos que menos el nombre de la
//      base de datos del tenant, que es justo lo que el aislamiento no debe exponer.
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../../app.js';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { initBaseConnection, closeAll } from '../../db/tenantConnections.js';
import { createTenantAndToken } from '../helpers/tenantAuth.js';

let mongod;
let auth;
const DB_NAME = 'tenant_errores_api';

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await connectControlPlane(uri);
  initBaseConnection(uri);
  await getControlModels().User.init();
  ({ auth } = await createTenantAndToken({ name: 'Errores SA', dbName: DB_NAME }));
});

afterAll(async () => {
  await closeControlPlane();
  await closeAll();
  await mongod.stop();
});

/** Todo el texto que la respuesta le devuelve al cliente. */
const cuerpo = (res) => JSON.stringify(res.body);

describe('El error nunca filtra detalle interno', () => {
  it('POST /api/tires con código duplicado da un mensaje de negocio, sin E11000 ni el nombre de la DB', async () => {
    const tire = { code: 7001, brand: 'B', pattern: 'P', serialNumber: 'SN-7001', size: 'S', status: 'Nueva', orderNumber: '2026-007001' };

    const primera = await request(app).post('/api/tires').set(auth).send(tire);
    expect(primera.status).toBe(201);

    const duplicada = await request(app).post('/api/tires').set(auth).send({ ...tire, serialNumber: 'SN-7001-bis', orderNumber: '2026-000001' });
    expect(duplicada.status).toBe(400);

    const texto = cuerpo(duplicada);
    expect(texto).not.toMatch(/E11000/i);
    expect(texto).not.toMatch(/duplicate key/i);
    expect(texto).not.toMatch(new RegExp(DB_NAME, 'i'));
    expect(texto).not.toMatch(/tenant_/i);
    // y sí dice algo que un operario entiende, mencionando el código conflictivo
    expect(duplicada.body.message).toMatch(/7001/);
  });
});

describe('Un :id malformado responde, no cuelga ni explota', () => {
  // Sin asyncHandler, un CastError dentro de un middleware async en Express 4 queda como
  // unhandled rejection y la request nunca responde: la conexión se cuelga hasta el timeout.
  it.each([
    ['GET', '/api/tires/no-es-un-objectid'],
    ['GET', '/api/vehicles/no-es-un-objectid/positions'],
  ])('%s %s', async (metodo, ruta) => {
    const res = await request(app)[metodo.toLowerCase()](ruta).set(auth).timeout(5000);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(cuerpo(res)).not.toMatch(/CastError|ObjectId failed|tenant_/i);
  });
});

describe('Un body inválido da 400, no 500', () => {
  const crearCubierta = async (code) => {
    const res = await request(app).post('/api/tires').set(auth).send({
      code, brand: 'B', pattern: 'P', serialNumber: `SN-${code}`, size: 'S', status: 'Nueva', orderNumber: '2026-000001' });
    expect(res.status).toBe(201);
    return res.body._id;
  };

  it('PATCH /api/tires/:id/correct con el body vacío', async () => {
    const id = await crearCubierta(7100);
    const res = await request(app).patch(`/api/tires/${id}/correct`).set(auth).send({ orderNumber: '2026-000001' });
    expect(res.status).toBe(400);
    expect(cuerpo(res)).not.toMatch(/Cannot destructure|undefined|TypeError/i);
  });

  it('PATCH /api/tires/:id/correct sin la clave form', async () => {
    const id = await crearCubierta(7101);
    const res = await request(app).patch(`/api/tires/${id}/correct`).set(auth).send({ orderNumber: '2026-000019' });
    expect(res.status).toBe(400);
    expect(cuerpo(res)).not.toMatch(/Cannot destructure|TypeError/i);
  });
});
