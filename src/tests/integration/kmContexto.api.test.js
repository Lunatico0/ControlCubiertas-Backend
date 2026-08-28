import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../../app.js';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { initBaseConnection, closeAll, getTenantDb } from '../../db/tenantConnections.js';
import { registerModels } from '../../db/registerModels.js';
import { createTenantAndToken } from '../helpers/tenantAuth.js';

// t141 de la auditoría de QA del operario.
//
// El formulario de desasignar pide "Kilometraje final" y nada más. Se puso 100 y el error fue
// "Kilometraje de baja no puede ser menor que el de alta": correcto y entendible, pero SIN
// decir cuál era ese valor. El operario tiene que cerrar el modal, ir al historial, anotar el
// número y volver — dos o tres pasos extra en la acción más frecuente después de asignar.
//
// El backend ya tiene el dato en la mano cuando lanza el error (lo acaba de calcular del
// historial). Ponerlo en el mensaje no cuesta una query.

const DB = 'tenant_kmctx';
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
  ({ auth } = await createTenantAndToken({ name: 'KM SA', dbName: DB }));
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
  return res.body._id;
};

// Por API, no por el modelo: el alta deja la entrada de historial de la que se deriva el
// estado de la cubierta en cada recálculo.
const crearCubierta = async (code) => {
  const res = await request(app).post('/api/tires').set(auth).send({
    status: 'Nueva', code, brand: 'Michelin', pattern: 'XZA', size: '295/80R22.5',
    serialNumber: `SN${code}`, orderNumber: `2026-00${code}`,
  });
  return res.body?.tire || res.body;
};

describe('t141 · el error de kilometraje dice contra QUÉ valor se compara', () => {
  it('nombra el odómetro al montar, para no tener que ir al historial a buscarlo', async () => {
    const vehId = await crearVehiculo('M-km1', 'KMA101');
    const tire = await crearCubierta(7101);

    const asignar = await request(app).patch(`/api/tires/${tire._id}/assign`).set(auth)
      .send({ vehicle: vehId, kmAlta: 200000, orderNumber: '2026-000101', position: 'E1-I' });
    expect(asignar.status).toBe(200);

    const res = await request(app).patch(`/api/tires/${tire._id}/unassign`).set(auth)
      .send({ kmBaja: 100, orderNumber: '2026-000102' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/200\.000|200000/); // el valor concreto, formateado o no
  });

  it('el mensaje sigue explicando la regla, no sólo tirando un número', async () => {
    const vehId = await crearVehiculo('M-km2', 'KMA102');
    const tire = await crearCubierta(7102);

    await request(app).patch(`/api/tires/${tire._id}/assign`).set(auth)
      .send({ vehicle: vehId, kmAlta: 50000, orderNumber: '2026-000103', position: 'E1-I' });

    const res = await request(app).patch(`/api/tires/${tire._id}/unassign`).set(auth)
      .send({ kmBaja: 10, orderNumber: '2026-000104' });

    expect(res.body.message).toMatch(/od[óo]metro/i);
    expect(res.body.field).toBe('kmBaja');
  });

  it('una desasignación válida sigue funcionando igual', async () => {
    const vehId = await crearVehiculo('M-km3', 'KMA103');
    const tire = await crearCubierta(7103);

    await request(app).patch(`/api/tires/${tire._id}/assign`).set(auth)
      .send({ vehicle: vehId, kmAlta: 10000, orderNumber: '2026-000105', position: 'E1-I' });

    const res = await request(app).patch(`/api/tires/${tire._id}/unassign`).set(auth)
      .send({ kmBaja: 15000, orderNumber: '2026-000106' });

    expect(res.status).toBe(200);
    // La cubierta RECORRIÓ 5.000 km; el 15.000 es el odómetro del móvil, no de la cubierta.
    // Es justo la distinción que el vocabulario de la UI borraba (t140).
    expect(res.body.kmRecorridos).toBe(5000);
    expect(res.body.tire.kilometers).toBe(5000);
  });
});
