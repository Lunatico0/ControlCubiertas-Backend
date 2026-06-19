import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../../app.js';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { initBaseConnection, closeAll } from '../../db/tenantConnections.js';
import { createTenantAndToken } from '../helpers/tenantAuth.js';

let mongod;
let A;
let B;

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await connectControlPlane(uri);
  initBaseConnection(uri);
  await getControlModels().User.init();
  A = await createTenantAndToken({ name: 'Alpha', dbName: 'tenant_alpha' });
  B = await createTenantAndToken({ name: 'Beta', dbName: 'tenant_beta' });
});

afterAll(async () => {
  await closeControlPlane();
  await closeAll();
  await mongod.stop();
});

const tirePayload = (serial) => ({
  code: 1, // mismo code en ambos tenants: solo posible si las DBs están aisladas
  brand: 'X',
  pattern: 'P',
  serialNumber: serial,
  size: 'S',
  status: 'Nueva',
});

describe('Aislamiento DB-per-tenant por HTTP', () => {
  it('cada tenant opera en su propia DB y no ve la del otro', async () => {
    // A y B crean una cubierta con el MISMO code: si compartieran DB, el 2do fallaría (unique)
    const ra = await request(app).post('/api/tires').set(A.auth).send(tirePayload('SN-A'));
    const rb = await request(app).post('/api/tires').set(B.auth).send(tirePayload('SN-B'));
    expect(ra.status).toBe(201);
    expect(rb.status).toBe(201);

    // A solo ve SU cubierta
    const listA = await request(app).get('/api/tires').set(A.auth);
    expect(listA.status).toBe(200);
    expect(listA.body).toHaveLength(1);
    expect(listA.body[0].serialNumber).toBe('SN-A');

    // B solo ve LA SUYA
    const listB = await request(app).get('/api/tires').set(B.auth);
    expect(listB.status).toBe(200);
    expect(listB.body).toHaveLength(1);
    expect(listB.body[0].serialNumber).toBe('SN-B');
  });
});
