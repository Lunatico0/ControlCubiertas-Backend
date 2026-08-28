import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../../app.js';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { initBaseConnection, closeAll } from '../../db/tenantConnections.js';
import { createTenantAndToken } from '../helpers/tenantAuth.js';

// Configurar ejes de un vehículo EXISTENTE (los migrados sin esquema). PATCH /:id/axles.
let mongod;
let auth;

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await connectControlPlane(uri);
  initBaseConnection(uri);
  await getControlModels().User.init();
  ({ auth } = await createTenantAndToken({ name: 'Acme', dbName: 'tenant_cfgejes' }));
});

afterAll(async () => {
  await closeControlPlane();
  await closeAll();
  await mongod.stop();
});

describe('PATCH /api/vehicles/:id/axles — configurar ejes de un vehículo existente', () => {
  it('asigna el esquema de ejes a un vehículo creado sin ejes', async () => {
    const veh = await request(app).post('/api/vehicles').set(auth).send({ brand: 'Scania', mobile: 'M-cfg', licensePlate: 'CFG101' });
    expect(veh.status).toBe(201);
    expect(veh.body.axles || []).toHaveLength(0); // arranca sin ejes
    const id = veh.body._id;

    const res = await request(app).patch(`/api/vehicles/${id}/axles`).set(auth).send({
      axles: [{ type: 'simple' }, { type: 'dual' }],
      kilometers: 5000,
    });
    expect(res.status).toBe(200);
    expect(res.body.axles).toHaveLength(2);
    expect(res.body.kilometers).toBe(5000);

    // el esquema se refleja en las posiciones (camión 4×2 = 6)
    const pos = await request(app).get(`/api/vehicles/${id}/positions`).set(auth);
    expect(pos.body.positions).toHaveLength(6);
  });

  it('acepta ejes moto (rueda única)', async () => {
    const veh = await request(app).post('/api/vehicles').set(auth).send({ brand: 'Honda', mobile: 'Moto-cfg', licensePlate: 'CFG103' });
    const id = veh.body._id;
    const res = await request(app).patch(`/api/vehicles/${id}/axles`).set(auth).send({ axles: [{ type: 'moto' }, { type: 'moto' }] });
    expect(res.status).toBe(200);
    expect(res.body.axles).toHaveLength(2);
  });

  it('rechaza un type de eje inválido', async () => {
    const veh = await request(app).post('/api/vehicles').set(auth).send({ brand: 'X', mobile: 'M-bad', licensePlate: 'CFG102' });
    const res = await request(app).patch(`/api/vehicles/${veh.body._id}/axles`).set(auth).send({ axles: [{ type: 'triple' }] });
    expect(res.status).toBe(400);
  });

  it('404 si el vehículo no existe', async () => {
    const res = await request(app).patch('/api/vehicles/64b7f000000000000000a000/axles').set(auth).send({ axles: [{ type: 'simple' }] });
    expect(res.status).toBe(404);
  });
});
