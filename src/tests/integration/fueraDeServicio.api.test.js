import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../../app.js';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { initBaseConnection, closeAll, getTenantDb } from '../../db/tenantConnections.js';
import { registerModels } from '../../db/registerModels.js';
import { createTenantAndToken } from '../helpers/tenantAuth.js';

// t145 de la auditoría de QA del operario.
//
// "PARA HOY" del Inicio lista, entre otras cosas, todo vehículo sin cubiertas montadas. Apenas
// se crearon dos vehículos de prueba, los dos aparecieron ahí como "Sin cubiertas montadas ·
// Montar", y no había forma de descartarlos, posponerlos ni marcarlos como no aplicables.
//
// Un acoplado de temporada o un móvil fuera de servicio queda clavado en la lista de tareas
// del día, TODOS los días. La lista pierde credibilidad y el operario deja de mirarla — y
// entonces también deja de ver lo que sí importa.
//
// Un vehículo fuera de servicio es un HECHO DEL NEGOCIO, no una preferencia del dispositivo:
// si el acoplado está parado, lo está para todos los que abren la app. Por eso el flag vive en
// el vehículo (data plane) y no en el localStorage de quien lo descartó.

const DB = 'tenant_fueraserv';
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
  ({ auth } = await createTenantAndToken({ name: 'Servicio SA', dbName: DB }));
  db = registerModels(getTenantDb(DB));
});

afterAll(async () => {
  await closeControlPlane();
  await closeAll();
  await mongod.stop();
});

const crearVehiculo = async (mobile, plate) => {
  const res = await request(app).post('/api/vehicles').set(auth)
    .send({ brand: 'Scania', mobile, licensePlate: plate, axles: [{ type: 'simple' }] });
  return res.body;
};

describe('t145 · marcar un vehículo fuera de servicio', () => {
  it('nace en servicio: el default no cambia el comportamiento de ningún vehículo existente', async () => {
    const v = await crearVehiculo('M-fs1', 'FSV101');

    expect(v.outOfService).toBe(false);
  });

  it('se marca fuera de servicio y queda persistido', async () => {
    const v = await crearVehiculo('M-fs2', 'FSV102');

    const res = await request(app).patch(`/api/vehicles/${v._id}/service`).set(auth)
      .send({ outOfService: true });

    expect(res.status).toBe(200);
    expect(res.body.outOfService).toBe(true);

    const guardado = await db.Vehicle.findById(v._id);
    expect(guardado.outOfService).toBe(true);
  });

  it('se puede volver a poner en servicio: no es una decisión de una sola vía', async () => {
    const v = await crearVehiculo('M-fs3', 'FSV103');

    await request(app).patch(`/api/vehicles/${v._id}/service`).set(auth).send({ outOfService: true });
    const res = await request(app).patch(`/api/vehicles/${v._id}/service`).set(auth).send({ outOfService: false });

    expect(res.body.outOfService).toBe(false);
  });

  it('rechaza un valor que no sea booleano en vez de guardar cualquier cosa', async () => {
    const v = await crearVehiculo('M-fs4', 'FSV104');

    const res = await request(app).patch(`/api/vehicles/${v._id}/service`).set(auth)
      .send({ outOfService: 'si' });

    expect(res.status).toBe(400);
  });

  it('404 en un vehículo inexistente, no 500', async () => {
    const res = await request(app).patch('/api/vehicles/64b7f9c2e1a2b3c4d5e6f708/service').set(auth)
      .send({ outOfService: true });

    expect(res.status).toBe(404);
  });

  it('un vehículo fuera de servicio con cubiertas montadas NO se toca: solo se marca', async () => {
    const v = await crearVehiculo('M-fs5', 'FSV105');
    await db.Tire.create({
      status: 'Nueva', code: 8105, brand: 'B', pattern: 'P', size: 'S', serialNumber: 'SN8105',
      vehicle: v._id, position: 'E1-I',
    });

    await request(app).patch(`/api/vehicles/${v._id}/service`).set(auth).send({ outOfService: true });

    // Marcarlo fuera de servicio es una anotación, no una baja: las cubiertas siguen montadas.
    const montadas = await db.Tire.countDocuments({ vehicle: v._id });
    expect(montadas).toBe(1);
  });

  it('el listado lo devuelve, para que el front pueda filtrarlo y mostrarlo distinto', async () => {
    const res = await request(app).get('/api/vehicles').set(auth);

    const fuera = res.body.find((x) => x.mobile === 'M-fs2');
    expect(fuera.outOfService).toBe(true);
  });
});
