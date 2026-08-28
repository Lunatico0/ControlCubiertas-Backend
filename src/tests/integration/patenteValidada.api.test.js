import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../../app.js';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { initBaseConnection, closeAll, getTenantDb } from '../../db/tenantConnections.js';
import { registerModels } from '../../db/registerModels.js';
import { createTenantAndToken } from '../helpers/tenantAuth.js';

// t138 de la auditoría de QA del operario, del lado de la API.
//
// (a) POST /vehicles aceptaba "ABC1234XYZ": ninguna validación de formato.
// (b) el chequeo de duplicados comparaba por igualdad contra la forma canónica, así que una
//     fila LEGACY guardada con guion ("ABC-301") no era encontrada por "ABC301" y el alta
//     duplicada pasaba. Quedaban dos vehículos con la misma chapa en dos formatos.
//
// Los formatos son configurables por tenant (plateFormats). El default es el set argentino;
// la lista vacía apaga la validación para una flota con chapas extranjeras.

const DB = 'tenant_patentes';
let mongod;
let auth;
let tenantId;
let db;

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await connectControlPlane(uri);
  initBaseConnection(uri);
  await getControlModels().User.init();
  ({ auth, tenant: { _id: tenantId } = {} } = await createTenantAndToken({ name: 'Patentes SA', dbName: DB }));
  db = registerModels(getTenantDb(DB));
});

afterAll(async () => {
  await closeControlPlane();
  await closeAll();
  await mongod.stop();
});

const crear = (body) => request(app).post('/api/vehicles').set(auth)
  .send({ brand: 'Scania', axles: [{ type: 'simple' }], ...body });

const setFormatos = (plateFormats) =>
  getControlModels().Tenant.findByIdAndUpdate(tenantId, { plateFormats });

describe('t138 (a) · formato de patente', () => {
  it('rechaza la patente del hallazgo con 400 y el campo señalado', async () => {
    const res = await crear({ mobile: 'M-fmt1', licensePlate: 'ABC1234XYZ' });

    expect(res.status).toBe(400);
    expect(res.body.field).toBe('licensePlate');
    expect(res.body.message).toMatch(/formato/i);
  });

  it('acepta el dominio viejo y el Mercosur', async () => {
    expect((await crear({ mobile: 'M-fmt2', licensePlate: 'ABC301' })).status).toBe(201);
    expect((await crear({ mobile: 'M-fmt3', licensePlate: 'AB123CD' })).status).toBe(201);
  });

  it('guarda la forma canónica aunque llegue con separador y en minúscula', async () => {
    const res = await crear({ mobile: 'M-fmt4', licensePlate: 'zzz-999' });

    expect(res.status).toBe(201);
    expect(res.body.licensePlate).toBe('ZZZ999');
  });

  it('con plateFormats vacío el tenant puede cargar una chapa extranjera', async () => {
    await setFormatos([]);
    const res = await crear({ mobile: 'M-fmt5', licensePlate: 'ABC1234XYZ' });
    await setFormatos(undefined);

    expect(res.status).toBe(201);
  });
});

describe('t138 (b) · duplicado contra una patente legacy con separador', () => {
  it('no deja crear un segundo vehículo con la misma chapa guardada con guion', async () => {
    // Fila LEGACY: se escribe directo al modelo, saltando la normalización del controlador.
    await db.Vehicle.create({ brand: 'Volvo', mobile: 'M-legacy', licensePlate: 'LEG-303', axles: [{ type: 'simple' }], tires: [] });

    const res = await crear({ mobile: 'M-dup', licensePlate: 'LEG303' });

    expect(res.status).toBe(400);
    expect(res.body.field).toBe('licensePlate');
    expect(res.body.message).toMatch(/patente/i);
  });

  it('una patente parecida pero distinta sí entra', async () => {
    const res = await crear({ mobile: 'M-nodup', licensePlate: 'LEG304' });

    expect(res.status).toBe(201);
  });

  it('editar un vehículo no lo hace chocar contra sí mismo', async () => {
    const { body } = await crear({ mobile: 'M-edit', licensePlate: 'EDI100' });

    const res = await request(app).put(`/api/vehicles/details/${body._id}`).set(auth)
      .send({ mobile: 'M-edit', licensePlate: 'EDI-100', brand: 'Volvo', type: 'Camión' });

    expect(res.status).toBe(200);
    expect(res.body.licensePlate).toBe('EDI100');
  });
});
