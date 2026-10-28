// Contrato de errores de la API.
//
// Dos reglas que valen para TODA la API multi-tenant:
//   1. Un input inválido responde 4xx, nunca 5xx ni una request que queda colgada.
//   2. El cuerpo del error nunca filtra detalles internos — y menos que menos el nombre de la
//      base de datos del tenant, que es justo lo que el aislamiento no debe exponer.
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { jest } from '@jest/globals';
import app, { debeReportarASentry } from '../../app.js';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { initBaseConnection, closeAll, getTenantDb } from '../../db/tenantConnections.js';
import { registerModels } from '../../db/registerModels.js';
import { httpError } from '../../utils/httpError.js';
import { createTenantAndToken } from '../helpers/tenantAuth.js';

let mongod;
let auth;
let db;
const DB_NAME = 'tenant_errores_api';

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await connectControlPlane(uri);
  initBaseConnection(uri);
  await getControlModels().User.init();
  ({ auth } = await createTenantAndToken({ name: 'Errores SA', dbName: DB_NAME }));
  db = registerModels(getTenantDb(DB_NAME));
});

afterEach(() => jest.restoreAllMocks());

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

// S15-b. La red de seguridad del E11000 (la que cubre al endpoint que se olvidó el pre-check)
// armaba 'Ya existe un registro con ese valor de "code" (1)': el nombre interno del campo, en
// inglés y entre comillas, llegaba tal cual al toast del operario.
//
// Los endpoints de alta tienen su pre-check y su try/catch propio, así que para llegar a la
// red se usa un E11000 REAL del driver (dos inserts crudos contra el índice único) y se lo hace
// salir de una ruta que delega en el handler central (GET /api/vehicles, vía asyncHandler).
const e11000Real = async (Model, primero, segundo = primero) => {
  await Model.init();
  await Model.collection.insertOne({ ...primero });
  try {
    await Model.collection.insertOne({ ...segundo });
  } catch (err) {
    return err;
  }
  throw new Error('se esperaba un E11000');
};

const fallarListadoDeVehiculos = (err) =>
  jest.spyOn(db.Vehicle, 'find').mockImplementation(() => ({ populate: () => Promise.reject(err) }));

describe('El E11000 que se escapa del pre-check se lee en castellano', () => {
  it.each([
    ['code', 'ese código interno', 7201],
    ['licensePlate', 'esa patente', 'AB201CD'],
    ['mobile', 'ese móvil', 'M-201'],
  ])('campo %s', async (campo, etiqueta, valor) => {
    // En vehículos el segundo insert repite SÓLO el campo bajo prueba: con los dos repetidos,
    // Mongo reporta el primer índice que choca y no el que se quiere ver.
    const vehiculo = (n) => ({ mobile: `M-${campo}-${n}`, licensePlate: `P-${campo}-${n}`, [campo]: valor });
    const err = campo === 'code'
      ? await e11000Real(db.Tire, { code: valor })
      : await e11000Real(db.Vehicle, vehiculo(1), vehiculo(2));
    expect(err.code).toBe(11000);
    expect(Object.keys(err.keyValue)).toEqual([campo]);

    fallarListadoDeVehiculos(err);
    const res = await request(app).get('/api/vehicles').set(auth);

    expect(res.status).toBe(400);
    expect(res.body.field).toBe(campo);
    expect(res.body.message).toBe(`Ya existe un registro con ${etiqueta} (${valor})`);
    expect(cuerpo(res)).not.toMatch(/E11000|duplicate key|tenant_/i);
  });

  it('un campo sin etiqueta conocida no expone su nombre interno', async () => {
    const err = Object.assign(new Error('E11000 duplicate key error collection: tenant_x.cosas'), { code: 11000, keyValue: { internalRef: 'X1' } });
    fallarListadoDeVehiculos(err);

    const res = await request(app).get('/api/vehicles').set(auth);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Ya existe un registro con esos datos');
    expect(cuerpo(res)).not.toMatch(/E11000|tenant_/i);
  });
});

// I2. Sentry decide qué reportar con este filtro, y sólo tiene sentido si lo que recibe ya
// está normalizado: un E11000 crudo no trae `status` y se tomaría como 500. El recorrido
// completo (normalización ANTES del handler de Sentry) se prueba en sentryActivacion.test.js.
describe('El filtro de Sentry sólo deja pasar fallas del servidor', () => {
  it('un 4xx de negocio no se reporta', () => {
    expect(debeReportarASentry(httpError('Ya existe un registro con ese código interno (1)', 400, 'code'))).toBe(false);
    expect(debeReportarASentry(httpError('Cubierta no encontrada', 404))).toBe(false);
  });

  it('un error sin status (inesperado) y un 5xx sí se reportan', () => {
    expect(debeReportarASentry(new Error('boom'))).toBe(true);
    expect(debeReportarASentry(httpError('Servicio caído', 503))).toBe(true);
  });
});
