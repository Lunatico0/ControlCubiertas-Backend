import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { jest } from '@jest/globals';
import app from '../../app.js';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { initBaseConnection, closeAll, getTenantDb } from '../../db/tenantConnections.js';
import { registerModels } from '../../db/registerModels.js';
import { createTenantAndToken } from '../helpers/tenantAuth.js';

// t30 de la auditoría del backend.
//
// PUT /api/vehicles/:id tenía DOS updateMany envueltos en try/catch que solo hacían
// console.error y dejaban seguir el flujo. Si el desvinculado (o el vinculado) de cubiertas
// fallaba, la request terminaba respondiendo 200: el cliente veía "guardado" mientras las
// cubiertas quedaban apuntando a un vehículo del que ya no forman parte. Ese es exactamente
// el desync que después hay que salir a reparar con un script.
//
// Un error de escritura no es algo para loguear y seguir: es el motivo para abortar.
//
// De paso, el catch de esa ruta devolvía `error: error.message` al cliente — el texto crudo
// de Mongo, con el nombre de la DB del tenant y el índice adentro.

const DB = 'tenant_escrituras';
let mongod;
let auth;
let db;

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await connectControlPlane(uri);
  initBaseConnection(uri);
  await getControlModels().User.init();
  ({ auth } = await createTenantAndToken({ name: 'Escrituras SA', dbName: DB }));
  db = registerModels(getTenantDb(DB));
});

afterAll(async () => {
  await closeControlPlane();
  await closeAll();
  await mongod.stop();
});

afterEach(() => jest.restoreAllMocks());

const crearVehiculo = async (mobile, plate) => {
  const res = await request(app).post('/api/vehicles').set(auth)
    .send({ brand: 'Scania', mobile, licensePlate: plate, axles: [{ type: 'simple' }] });
  return res.body._id;
};

const crearCubierta = async (code) => {
  const res = await request(app).post('/api/tires').set(auth).send({
    status: 'Nueva', code, brand: 'B', pattern: 'P', size: 'S',
    serialNumber: `SN${code}`, orderNumber: `2026-00${code}`,
  });
  return res.body?.tire || res.body;
};

describe('t30 · un fallo de escritura no puede terminar en 200', () => {
  it('si el vinculado de cubiertas falla, la respuesta NO es 200', async () => {
    const vehId = await crearVehiculo('M-esc1', 'ESC101');
    const tire = await crearCubierta(9101);

    jest.spyOn(db.Tire, 'updateMany').mockRejectedValueOnce(new Error('write concern error: no primary'));

    const res = await request(app).put(`/api/vehicles/${vehId}`).set(auth)
      .send({ tires: [String(tire._id)] });

    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('el 500 no filtra el texto crudo del driver al cliente', async () => {
    const vehId = await crearVehiculo('M-esc2', 'ESC102');
    const tire = await crearCubierta(9102);

    jest.spyOn(db.Tire, 'updateMany').mockRejectedValueOnce(new Error('E11000 duplicate key error collection: tenant_escrituras.tires'));

    const res = await request(app).put(`/api/vehicles/${vehId}`).set(auth)
      .send({ tires: [String(tire._id)] });

    const cuerpo = JSON.stringify(res.body);
    expect(cuerpo).not.toMatch(/E11000/);
    expect(cuerpo).not.toMatch(new RegExp(DB));
  });

  it('sin fallos, la ruta sigue funcionando y vincula la cubierta', async () => {
    const vehId = await crearVehiculo('M-esc3', 'ESC103');
    const tire = await crearCubierta(9103);

    const res = await request(app).put(`/api/vehicles/${vehId}`).set(auth)
      .send({ tires: [String(tire._id)] });

    expect(res.status).toBe(200);
    const guardada = await db.Tire.findById(tire._id);
    expect(String(guardada.vehicle)).toBe(String(vehId));
  });
});
