import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../../app.js';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { initBaseConnection, closeAll, getTenantDb } from '../../db/tenantConnections.js';
import { createTenantAndToken } from '../helpers/tenantAuth.js';

// Dos problemas distintos que se cruzan en el mismo lugar, el handler de errores de app.js:
//
// 1) FUGA DE INTERNAS. En los 5xx el handler devolvía `err.message` tal cual. Un error
//    inesperado sale entonces con su texto técnico: en PRODUCCIÓN, un login con el email
//    como objeto respondía 500 con "email?.toLowerCase is not a function". El schema Zod ya
//    tapa ese caso puntual, pero la fuga es del handler y aplica a cualquier otro error que
//    ningún schema cubra. El cliente nunca tiene que ver el interior.
//
// 2) ERRORES DE NEGOCIO DISFRAZADOS DE 500. Los servicios tiran `new Error('Cubierta no
//    encontrada')` sin status, así que caían en el 500 por descarte. Eso significa que un
//    id inexistente (input inválido, cosa esperable) figura como falla del servidor, dispara
//    alerta en Sentry y contamina la señal: la próxima alerta REAL queda enterrada entre
//    "no encontrado".
//
// Los dos se arreglan juntos, y en este orden: primero los de negocio pasan a 4xx con su
// mensaje, y RECIÉN DESPUÉS el 500 puede genericarse sin quedarse mudo.

let mongod;
let auth;
let db;
let seq = 900;

const DB_NAME = 'tenant_errores';
const ID_INEXISTENTE = '6a8cf31e9dc09fd9d4f9ffff';

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await connectControlPlane(uri);
  initBaseConnection(uri);
  await getControlModels().User.init();
  ({ auth } = await createTenantAndToken({ name: 'Errores', dbName: DB_NAME }));
  db = getTenantDb(DB_NAME).models;
});

afterAll(async () => {
  await closeControlPlane();
  await closeAll();
  await mongod.stop();
});

const INTERNAS = /is not a function|TypeError|Cannot read|undefined|at Module|node_modules|\.js:\d+/i;

describe('el cliente nunca ve las internas del server', () => {
  it('un login con el email como objeto da 400, y sin el texto del TypeError', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: { $ne: null }, password: 'x' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(INTERNAS);
  });

  it('ninguna respuesta de error filtra rutas de archivo ni stack', async () => {
    const respuestas = await Promise.all([
      request(app).post('/api/auth/login').send({ email: 12345, password: 'x' }),
      request(app).post('/api/auth/refresh').send({ refreshToken: 'no-es-un-jwt' }),
      request(app).get(`/api/tires/${ID_INEXISTENTE}`).set(auth),
      request(app).patch(`/api/tires/${ID_INEXISTENTE}/status`).set(auth).send({ status: 'Nueva', orderNumber: 'O' }),
    ]);
    for (const res of respuestas) {
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(res.body)).not.toMatch(INTERNAS);
    }
  });
});

describe('los errores de negocio son 4xx, no 500', () => {
  it('pedir una cubierta que no existe da 404 con su mensaje', async () => {
    const res = await request(app).get(`/api/tires/${ID_INEXISTENTE}`).set(auth);
    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/no encontrada/i);
  });

  it('corregir sin cambios reales da 400 y explica por qué', async () => {
    const alta = await request(app).post('/api/tires').set(auth).send({
      status: 'Nueva', code: ++seq, brand: 'B', pattern: 'P', size: 'S', serialNumber: `SN${seq}`,
    });
    const id = alta.body.tire?._id || alta.body._id;

    // Mismos valores que ya tiene: el servicio corta con "no se detectaron cambios".
    const res = await request(app).patch(`/api/tires/${id}/correct`).set(auth)
      .send({ form: { brand: 'B', reason: 'sin cambios', orderNumber: 'O-1' } });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/cambio/i);
  });

  it('deshacer el alta de una cubierta da 4xx con el motivo, no 500', async () => {
    const alta = await request(app).post('/api/tires').set(auth).send({
      status: 'Nueva', code: ++seq, brand: 'B', pattern: 'P', size: 'S', serialNumber: `SN${seq}`,
    });
    const id = alta.body.tire?._id || alta.body._id;
    const entradaAlta = (await db.History.find({ tire: id, type: 'Alta' }))[0];

    const res = await request(app).post(`/api/tires/${id}/history/${entradaAlta._id}/undo`).set(auth)
      .send({ orderNumber: 'O-2' });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.body.message).toMatch(/alta/i);
  });

  it('un vehículo inexistente al asignar da 4xx, no 500', async () => {
    const alta = await request(app).post('/api/tires').set(auth).send({
      status: 'Nueva', code: ++seq, brand: 'B', pattern: 'P', size: 'S', serialNumber: `SN${seq}`,
    });
    const id = alta.body.tire?._id || alta.body._id;

    const res = await request(app).patch(`/api/tires/${id}/assign`).set(auth)
      .send({ vehicle: ID_INEXISTENTE, kmAlta: 1000, orderNumber: 'O-3' });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.body.message).toMatch(/veh[ií]culo/i);
  });

  it('una entrada de historial inexistente da 4xx, no 500', async () => {
    const alta = await request(app).post('/api/tires').set(auth).send({
      status: 'Nueva', code: ++seq, brand: 'B', pattern: 'P', size: 'S', serialNumber: `SN${seq}`,
    });
    const id = alta.body.tire?._id || alta.body._id;

    const res = await request(app).post(`/api/tires/${id}/history/${ID_INEXISTENTE}/undo`).set(auth)
      .send({ orderNumber: 'O-4' });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
