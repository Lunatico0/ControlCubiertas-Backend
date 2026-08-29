import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../../app.js';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { initBaseConnection, closeAll } from '../../db/tenantConnections.js';
import { createTenantAndToken } from '../helpers/tenantAuth.js';

// Dos rutas que resolvían un "no existe" de la peor manera posible:
//
// - GET /api/vehicles/:id no tenía ningún check tras el findById: un id inexistente devolvía
//   200 con body null (el frontend tiene que adivinar si eso es un vacío o un error) y uno
//   malformado tiraba CastError → 500. Su vecina getPositions ya devolvía 404 con el mismo
//   input, así que dos rutas del mismo recurso contestaban distinto.
//
// - correctHistoryEntry leía original.orderNumber ANTES del `if (!original) throw`, así que el
//   guard no corría nunca: con un historyId inexistente salía un TypeError y un 500 en vez del
//   404 que el código creía estar devolviendo.

let mongod;
let auth;

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await connectControlPlane(uri);
  initBaseConnection(uri);
  await getControlModels().User.init();
  ({ auth } = await createTenantAndToken({ name: 'Acme', dbName: 'tenant_notfound' }));
});

afterAll(async () => {
  await closeControlPlane();
  await closeAll();
  await mongod.stop();
});

const INEXISTENTE = '507f1f77bcf86cd799439011'; // ObjectId válido que no está en la DB

describe('GET /api/vehicles/:id con un id que no existe', () => {
  it('devuelve 404, no 200 con null', async () => {
    const res = await request(app).get(`/api/vehicles/${INEXISTENTE}`).set(auth);
    expect(res.status).toBe(404);
    expect(res.body).not.toBeNull();
    expect(res.body.message).toMatch(/no encontrado/i);
  });

  it('con un id malformado devuelve 400, no un 500 por CastError', async () => {
    const res = await request(app).get('/api/vehicles/no-es-un-objectid').set(auth);
    expect(res.status).toBe(400);
  });

  it('con un id que existe sigue devolviendo el vehículo', async () => {
    const alta = await request(app).post('/api/vehicles').set(auth).send({
      brand: 'Scania', mobile: 'Movil 1', licensePlate: 'AAA-111', kilometers: 100,
      axles: [{ type: 'simple' }],
    });
    expect(alta.status).toBe(201);

    const res = await request(app).get(`/api/vehicles/${alta.body._id}`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body._id).toBe(alta.body._id);
    expect(res.body.brand).toBe('Scania');
  });

  it('contesta igual que getPositions ante el mismo id inexistente', async () => {
    const detalle = await request(app).get(`/api/vehicles/${INEXISTENTE}`).set(auth);
    const posiciones = await request(app).get(`/api/vehicles/${INEXISTENTE}/positions`).set(auth);
    expect(detalle.status).toBe(posiciones.status);
  });
});

describe('Corregir una entrada de historial que no existe', () => {
  it('devuelve 404 con mensaje, no un 500 por TypeError', async () => {
    const tire = await request(app).post('/api/tires').set(auth).send({
      code: 900, brand: 'B', pattern: 'P', serialNumber: 'SN900', size: 'S', status: 'Nueva', orderNumber: '2026-000001' });
    expect(tire.status).toBe(201);

    const res = await request(app)
      .patch(`/api/tires/${tire.body._id}/history/${INEXISTENTE}`)
      .set(auth)
      .send({ form: { reason: 'ajuste', orderNumber: '2026-000003' } });

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/historial/i);
  });
});
