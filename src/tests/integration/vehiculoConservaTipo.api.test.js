import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../../app.js';
import { connectControlPlane, closeControlPlane } from '../../db/controlPlane.js';
import { initBaseConnection, getTenantDb, closeAll } from '../../db/tenantConnections.js';
import { createTenantAndToken } from '../helpers/tenantAuth.js';

// S1 (auditoría 2026-10-26): editar los datos de un vehículo le borraba el tipo. El drawer
// de edición no manda `type` (el tipo se define junto con los ejes) y el controller lo
// asignaba sin guard, así que cada guardado lo dejaba en undefined. Pasó en 102, 201 y D902.
// Criterio fijado: un campo opcional que NO viene en el body no se toca; si viene, se aplica
// (incluido `type: null`, que lo limpia a propósito, igual que en PATCH /:id/axles).

let mongod;
let auth;
let db;
const dbName = 'tenant_conserva_tipo';

let seq = 100;
const mkVehicle = (extra = {}) => db.Vehicle.create({
  brand: 'Scania', mobile: `M-${++seq}`, licensePlate: `AB${seq}CD`,
  type: 'Camión 4×2', axles: [{ type: 'simple' }, { type: 'dual' }], ...extra,
});

const putDetails = (id, body) => request(app).put(`/api/vehicles/details/${id}`).set(auth).send(body);

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
  mongod = await MongoMemoryServer.create();
  await connectControlPlane(mongod.getUri());
  initBaseConnection(mongod.getUri());
  db = getTenantDb(dbName).models;
  ({ auth } = await createTenantAndToken({ name: 'Conserva tipo', dbName }));
});

afterAll(async () => {
  await closeAll();
  await closeControlPlane();
  await mongod.stop();
});

describe('PUT /api/vehicles/details/:id conserva lo que no viene en el body (S1)', () => {
  it('sin `type` en el body conserva el tipo (el caso del drawer de edición)', async () => {
    const v = await mkVehicle();
    const res = await putDetails(v._id, { mobile: v.mobile, licensePlate: v.licensePlate, brand: 'Volvo' });

    expect(res.status).toBe(200);
    expect(res.body.type).toBe('Camión 4×2');
    expect(res.body.brand).toBe('Volvo');
    const enDb = await db.Vehicle.findById(v._id).lean();
    expect(enDb.type).toBe('Camión 4×2');
  });

  it('con `type` en el body lo cambia', async () => {
    const v = await mkVehicle();
    const res = await putDetails(v._id, { mobile: v.mobile, licensePlate: v.licensePlate, brand: 'Volvo', type: 'Camión 6×4' });

    expect(res.status).toBe(200);
    expect((await db.Vehicle.findById(v._id).lean()).type).toBe('Camión 6×4');
  });

  it('con `type: null` explícito lo limpia (mismo criterio que PATCH /:id/axles)', async () => {
    const v = await mkVehicle();
    const res = await putDetails(v._id, { mobile: v.mobile, licensePlate: v.licensePlate, type: null });

    expect(res.status).toBe(200);
    expect((await db.Vehicle.findById(v._id).lean()).type ?? null).toBeNull();
  });

  it('sin `brand` en el body conserva la marca (antes salía 500: brand es requerido en el modelo)', async () => {
    const v = await mkVehicle({ brand: 'Mercedes' });
    const res = await putDetails(v._id, { mobile: `${v.mobile}-b`, licensePlate: v.licensePlate });

    expect(res.status).toBe(200);
    const enDb = await db.Vehicle.findById(v._id).lean();
    expect(enDb.brand).toBe('Mercedes');
    expect(enDb.type).toBe('Camión 4×2');
    expect(enDb.mobile).toBe(`${v.mobile}-b`);
  });

  it('rechaza con 400 y `field` una marca vacía o null en vez de reventar con 500', async () => {
    const v = await mkVehicle({ brand: 'Iveco' });
    for (const brand of ['', '   ', null]) {
      const res = await putDetails(v._id, { mobile: v.mobile, licensePlate: v.licensePlate, brand });
      expect(res.status).toBe(400);
      expect(res.body.field).toBe('brand');
    }
    expect((await db.Vehicle.findById(v._id).lean()).brand).toBe('Iveco');
  });

  it('no toca los ejes ni el km al editar los datos', async () => {
    const v = await mkVehicle({ kilometers: 54000 });
    await putDetails(v._id, { mobile: v.mobile, licensePlate: v.licensePlate, brand: 'Volvo' });

    const enDb = await db.Vehicle.findById(v._id).lean();
    expect(enDb.axles.map((a) => a.type)).toEqual(['simple', 'dual']);
    expect(enDb.kilometers).toBe(54000);
  });
});
