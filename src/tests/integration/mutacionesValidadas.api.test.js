import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../../app.js';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { initBaseConnection, closeAll, getTenantDb } from '../../db/tenantConnections.js';
import { createTenantAndToken } from '../helpers/tenantAuth.js';

// Las ocho rutas de mutación que quedaron sin schema Zod. Los guards que había eran ad-hoc,
// dentro de cada controlador, y no cubrían todo: entraba cualquier campo extra del cliente.
// El caso más feo es PATCH /history/:historyId, donde el servicio hace `...updates.form`
// dentro del documento de History: sin schema, el cliente escribe campos arbitrarios en la
// colección.
//
// Cada bloque prueba las dos mitades: que lo inválido rebota con 400 Y que lo válido sigue
// pasando. La segunda mitad importa tanto como la primera, porque `validate` REEMPLAZA
// req.body con lo que devuelve Zod y todo campo no declarado se pierde en silencio: un
// schema incompleto rompe la app sin un solo error visible.

let mongod;
let auth;
let db;
let seq = 500;

const DB_NAME = 'tenant_mutaciones';

// Las cubiertas se dan de alta POR LA API a propósito: crearlas a mano con db.Tire.create
// las deja sin la entrada de historial del alta, y varios de estos caminos (desasignar,
// corregir historial) la necesitan. Un escenario a mano daba 500 por un motivo que no tiene
// nada que ver con lo que se está probando acá.
const crearCubierta = async (extra = {}) => {
  const res = await request(app).post('/api/tires').set(auth).send({
    status: 'Nueva', code: ++seq, brand: 'B', pattern: 'P', size: '295/80',
    serialNumber: `SN${seq}`, ...extra, orderNumber: '2026-000001' });
  if (res.status !== 201 && res.status !== 200) throw new Error(`alta fallida: ${res.status} ${JSON.stringify(res.body)}`);
  return db.Tire.findById(res.body.tire?._id || res.body._id);
};

const crearVehiculo = () =>
  db.Vehicle.create({
    brand: 'Scania', mobile: `M${++seq}`, licensePlate: `AAA${seq}`,
    axles: [{ type: 'simple' }, { type: 'dual' }],
  });

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await connectControlPlane(uri);
  initBaseConnection(uri);
  await getControlModels().User.init();
  ({ auth } = await createTenantAndToken({ name: 'Mutaciones', dbName: DB_NAME }));
  db = getTenantDb(DB_NAME).models;
});

afterAll(async () => {
  await closeControlPlane();
  await closeAll();
  await mongod.stop();
});

describe('PATCH /api/tires/:id/status', () => {
  it('sin status → 400', async () => {
    const t = await crearCubierta();
    const res = await request(app).patch(`/api/tires/${t._id}/status`).set(auth).send({ orderNumber: '2026-000020' });
    expect(res.status).toBe(400);
  });

  it('con status que no es string → 400', async () => {
    const t = await crearCubierta();
    const res = await request(app).patch(`/api/tires/${t._id}/status`).set(auth).send({ status: { $ne: null }, orderNumber: '2026-000001' });
    expect(res.status).toBe(400);
  });

  it('con un status válido del tenant sigue funcionando', async () => {
    const t = await crearCubierta();
    const res = await request(app).patch(`/api/tires/${t._id}/status`).set(auth)
      .send({ status: '1er Recapado', orderNumber: '2026-000021', receiptNumber: '0001-00000001' });
    expect(res.status).toBe(200);
    expect(res.body.tire.status).toBe('1er Recapado');
  });
});

describe('PATCH /api/tires/:id/assign', () => {
  it('sin kmAlta → 400', async () => {
    const t = await crearCubierta();
    const v = await crearVehiculo();
    const res = await request(app).patch(`/api/tires/${t._id}/assign`).set(auth).send({ vehicle: String(v._id), orderNumber: '2026-000001' });
    expect(res.status).toBe(400);
  });

  it('con kmAlta como string → 400', async () => {
    const t = await crearCubierta();
    const v = await crearVehiculo();
    const res = await request(app).patch(`/api/tires/${t._id}/assign`).set(auth)
      .send({ vehicle: String(v._id), kmAlta: '1000', orderNumber: '2026-000001' });
    expect(res.status).toBe(400);
  });

  it('con kmAlta negativo → 400', async () => {
    const t = await crearCubierta();
    const v = await crearVehiculo();
    const res = await request(app).patch(`/api/tires/${t._id}/assign`).set(auth)
      .send({ vehicle: String(v._id), kmAlta: -5, orderNumber: '2026-000001' });
    expect(res.status).toBe(400);
  });

  it('sin vehicle → 400', async () => {
    const t = await crearCubierta();
    const res = await request(app).patch(`/api/tires/${t._id}/assign`).set(auth).send({ kmAlta: 1000, orderNumber: '2026-000001' });
    expect(res.status).toBe(400);
  });

  it('con datos válidos asigna, y la posición no se pierde por el camino', async () => {
    const t = await crearCubierta();
    const v = await crearVehiculo();
    const res = await request(app).patch(`/api/tires/${t._id}/assign`).set(auth)
      .send({ vehicle: String(v._id), kmAlta: 1000, orderNumber: '2026-000022', position: 'E1-I' });
    expect(res.status).toBe(200);
    expect(res.body.tire.position).toBe('E1-I');
  });
});

describe('PATCH /api/tires/:id/unassign', () => {
  it('sin kmBaja → 400', async () => {
    const t = await crearCubierta();
    const res = await request(app).patch(`/api/tires/${t._id}/unassign`).set(auth).send({ orderNumber: '2026-000023' });
    expect(res.status).toBe(400);
  });

  it('con kmBaja absurdo (por encima del techo) → 400', async () => {
    const t = await crearCubierta();
    const res = await request(app).patch(`/api/tires/${t._id}/unassign`).set(auth).send({ kmBaja: 999999999, orderNumber: '2026-000001' });
    expect(res.status).toBe(400);
  });

  it('con kmBaja válido desasigna', async () => {
    const t = await crearCubierta();
    const v = await crearVehiculo();
    await request(app).patch(`/api/tires/${t._id}/assign`).set(auth)
      .send({ vehicle: String(v._id), kmAlta: 1000, orderNumber: '2026-000024' });

    const res = await request(app).patch(`/api/tires/${t._id}/unassign`).set(auth)
      .send({ kmBaja: 5000, orderNumber: '2026-000025' });
    expect(res.status).toBe(200);
  });
});

describe('PATCH /api/tires/:id/correct', () => {
  it('sin el bloque form → 400', async () => {
    const t = await crearCubierta();
    const res = await request(app).patch(`/api/tires/${t._id}/correct`).set(auth).send({ brand: 'Nueva marca', orderNumber: '2026-000001' });
    expect(res.status).toBe(400);
  });

  it('con form que no es objeto → 400', async () => {
    const t = await crearCubierta();
    const res = await request(app).patch(`/api/tires/${t._id}/correct`).set(auth).send({ form: 'texto', orderNumber: '2026-000001' });
    expect(res.status).toBe(400);
  });

  it('corrige la marca con un form válido', async () => {
    const t = await crearCubierta();
    const res = await request(app).patch(`/api/tires/${t._id}/correct`).set(auth)
      .send({ form: { brand: 'Michelin', reason: 'error de tipeo', orderNumber: '2026-000026' } });
    expect(res.status).toBe(200);
    expect(res.body.editedFields).toContain('brand');
  });

  it('no deja escribir campos fuera de los corregibles', async () => {
    const t = await crearCubierta();
    await request(app).patch(`/api/tires/${t._id}/correct`).set(auth)
      .send({ form: { brand: 'Pirelli', reason: 'r', kilometers: 999999, status: 'Descartada' }, orderNumber: '2026-000001' });

    const despues = await db.Tire.findById(t._id);
    expect(despues.kilometers).not.toBe(999999);
    expect(despues.status).toBe('Nueva');
  });
});

describe('PATCH /api/tires/:id/history/:historyId', () => {
  const historialDe = async (tireId) => (await db.History.find({ tire: tireId }).sort({ date: 1 }))[0];

  it('sin el bloque form → 400', async () => {
    const t = await crearCubierta();
    const h = await historialDe(t._id);
    const res = await request(app).patch(`/api/tires/${t._id}/history/${h._id}`).set(auth)
      .send({ orderNumber: '2026-000027' });
    expect(res.status).toBe(400);
  });

  it('no deja inyectar campos arbitrarios en el documento de History', async () => {
    // El servicio hace `...updates.form` dentro de la entrada nueva: sin schema, esto escribía
    // basura del cliente directo en la colección.
    const t = await crearCubierta();
    const h = await historialDe(t._id);
    const res = await request(app).patch(`/api/tires/${t._id}/history/${h._id}`).set(auth)
      .send({ form: { orderNumber: '2026-000028', reason: 'ajuste', campoInventado: 'x', flag: false } });

    expect(res.status).toBe(400);
  });

  it('corrige el kilometraje de una entrada con un form válido', async () => {
    const t = await crearCubierta();
    const v = await crearVehiculo();
    await request(app).patch(`/api/tires/${t._id}/assign`).set(auth)
      .send({ vehicle: String(v._id), kmAlta: 1000, orderNumber: '2026-000029' });

    const asignacion = (await db.History.find({ tire: t._id, type: 'Asignación' }))[0];
    const res = await request(app).patch(`/api/tires/${t._id}/history/${asignacion._id}`).set(auth)
      .send({ form: { kmAlta: 1200, orderNumber: '2026-000030', reason: 'odómetro mal leído' } });

    expect(res.status).toBe(200);
  });
});

describe('POST /api/tires/:id/history/:historyId/undo', () => {
  it('con reason que no es string → 400', async () => {
    const t = await crearCubierta();
    const h = (await db.History.find({ tire: t._id }))[0];
    const res = await request(app).post(`/api/tires/${t._id}/history/${h._id}/undo`).set(auth)
      .send({ orderNumber: '2026-000031', reason: { $ne: null } });
    expect(res.status).toBe(400);
  });

  it('deshace una asignación con un body válido', async () => {
    const t = await crearCubierta();
    const v = await crearVehiculo();
    await request(app).patch(`/api/tires/${t._id}/assign`).set(auth)
      .send({ vehicle: String(v._id), kmAlta: 1000, orderNumber: '2026-000032' });
    const asignacion = (await db.History.find({ tire: t._id, type: 'Asignación' }))[0];

    const res = await request(app).post(`/api/tires/${t._id}/history/${asignacion._id}/undo`).set(auth)
      .send({ orderNumber: '2026-000033', reason: 'se cargó en el móvil equivocado' });
    expect(res.status).toBe(200);
  });
});

describe('PUT /api/vehicles/details/:id', () => {
  it('sin mobile → 400', async () => {
    const v = await crearVehiculo();
    const res = await request(app).put(`/api/vehicles/details/${v._id}`).set(auth)
      .send({ licensePlate: 'ZZZ999', brand: 'Volvo', type: 'Tractor' });
    expect(res.status).toBe(400);
  });

  it('con mobile vacío → 400', async () => {
    const v = await crearVehiculo();
    const res = await request(app).put(`/api/vehicles/details/${v._id}`).set(auth)
      .send({ mobile: '   ', licensePlate: 'ZZZ998', brand: 'Volvo', type: 'Tractor' });
    expect(res.status).toBe(400);
  });

  it('con datos válidos actualiza los cuatro campos', async () => {
    const v = await crearVehiculo();
    const res = await request(app).put(`/api/vehicles/details/${v._id}`).set(auth)
      .send({ mobile: `MOD${++seq}`, licensePlate: `BBB${seq}`, brand: 'Volvo', type: 'Tractor' });
    expect(res.status).toBe(200);
    expect(res.body.brand).toBe('Volvo');
    expect(res.body.type).toBe('Tractor');
  });
});

describe('PUT /api/vehicles/:id', () => {
  it('sin tires → 400', async () => {
    const v = await crearVehiculo();
    const res = await request(app).put(`/api/vehicles/${v._id}`).set(auth).send({});
    expect(res.status).toBe(400);
  });

  it('con tires que no es array → 400', async () => {
    const v = await crearVehiculo();
    const res = await request(app).put(`/api/vehicles/${v._id}`).set(auth).send({ tires: 'no-soy-un-array' });
    expect(res.status).toBe(400);
  });

  it('con un id de cubierta que no es un ObjectId → 400', async () => {
    const v = await crearVehiculo();
    const res = await request(app).put(`/api/vehicles/${v._id}`).set(auth).send({ tires: ['no-es-un-id'] });
    expect(res.status).toBe(400);
  });

  it('con un array válido de cubiertas actualiza la flota del vehículo', async () => {
    const v = await crearVehiculo();
    const t = await crearCubierta();
    const res = await request(app).put(`/api/vehicles/${v._id}`).set(auth).send({ tires: [String(t._id)] });
    expect(res.status).toBe(200);
  });
});

// El informe de auditoría listaba ocho rutas y se salteó estas dos, que también reciben body
// del cliente sin schema. No hay bypass de autenticación (el `?.` corta la cadena antes del
// filtro de Mongo), pero un email que no es string sale como 500 con el error interno adentro,
// justo lo que la regla de errorHandling prohíbe mostrarle al cliente.
describe('POST /api/auth/login y /refresh', () => {
  it('login con email que no es string → 400, y sin filtrar el error interno', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: { $ne: null }, password: 'x' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/toLowerCase|TypeError|is not a function/i);
  });

  it('login sin password → 400', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'alguien@test.com' });
    expect(res.status).toBe(400);
  });

  it('login con credenciales mal pero bien formadas sigue dando 401, no 400', async () => {
    // El 401 genérico es lo que evita distinguir "no existe" de "contraseña incorrecta".
    const res = await request(app).post('/api/auth/login').send({ email: 'nadie@test.com', password: 'x' });
    expect(res.status).toBe(401);
  });

  it('refresh con un refreshToken que no es string → 400', async () => {
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: { a: 1 } });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/jwt must be|TypeError/i);
  });
});
