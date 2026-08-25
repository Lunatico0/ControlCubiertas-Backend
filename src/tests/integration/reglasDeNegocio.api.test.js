// Reglas de negocio que la API tiene que hacer cumplir SIEMPRE, venga el request de donde venga.
//
// La UI puede tener sus propios guards, pero no son la fuente de verdad: cualquiera puede pegarle
// al endpoint directo. Estos casos salieron del QA del flujo del operario, donde entraron
// kilómetros negativos (que después se imprimieron en un comprobante), fechas de 2030 y estados
// que no existen en la configuración del tenant.
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../../app.js';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { initBaseConnection, closeAll, getTenantDb } from '../../db/tenantConnections.js';
import { createTenantAndToken } from '../helpers/tenantAuth.js';

let mongod;
let auth;
const DB_NAME = 'tenant_reglas_negocio';
const models = () => getTenantDb(DB_NAME).models;

let seq = 8000;
const cubiertaValida = (extra = {}) => ({
  code: ++seq, brand: 'Bridgestone', pattern: 'Liso', serialNumber: `SN-${seq}`,
  size: '295/80 R22.5', status: 'Nueva', ...extra,
});

const crear = (body) => request(app).post('/api/tires').set(auth).send(body);

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await connectControlPlane(uri);
  initBaseConnection(uri);
  await getControlModels().User.init();
  ({ auth } = await createTenantAndToken({ name: 'Reglas SA', dbName: DB_NAME }));
});

afterAll(async () => {
  await closeControlPlane();
  await closeAll();
  await mongod.stop();
});

describe('Kilometraje: nunca negativo ni absurdo', () => {
  it('rechaza el alta con kilómetros negativos', async () => {
    const res = await crear(cubiertaValida({ kilometers: -500 }));
    expect(res.status).toBe(400);
    // y no quedó nada guardado
    expect(await models().Tire.findOne({ code: seq })).toBeNull();
  });

  it('acepta kilómetros en cero', async () => {
    const res = await crear(cubiertaValida({ kilometers: 0 }));
    expect(res.status).toBe(201);
    expect(res.body.kilometers).toBe(0);
  });

  it('rechaza un kilometraje imposible para una cubierta', async () => {
    const res = await crear(cubiertaValida({ kilometers: 999999999 }));
    expect(res.status).toBe(400);
  });

  it('rechaza un código de cubierta negativo', async () => {
    const res = await crear({ ...cubiertaValida(), code: -3 });
    expect(res.status).toBe(400);
  });
});

describe('Fecha de alta: nunca en el futuro', () => {
  it('rechaza una fecha de alta futura', async () => {
    const dentroDeUnAnio = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
    const res = await crear(cubiertaValida({ createdAt: dentroDeUnAnio }));
    expect(res.status).toBe(400);
  });

  it('acepta una fecha de alta pasada', async () => {
    const haceUnMes = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const res = await crear(cubiertaValida({ createdAt: haceUnMes }));
    expect(res.status).toBe(201);
  });
});

describe('Estado: siempre uno de los configurados por el tenant', () => {
  it('corregir una entrada del historial no puede meter un estado inexistente', async () => {
    const alta = await crear(cubiertaValida({ kilometers: 100 }));
    expect(alta.status).toBe(201);
    const tireId = alta.body._id;

    const [entrada] = await models().History.find({ tire: tireId }).sort({ date: 1 }).lean();
    expect(entrada).toBeTruthy();

    const res = await request(app)
      .patch(`/api/tires/${tireId}/history/${entrada._id}`)
      .set(auth)
      .send({ form: { status: 'Estado Inventado Que No Existe', reason: 'test', orderNumber: 'ORD-X' } });

    expect(res.status).toBe(400);

    // y la cubierta conserva su estado válido
    const tire = await models().Tire.findById(tireId).lean();
    expect(tire.status).toBe('Nueva');
  });
});
