import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../../app.js';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { initBaseConnection, closeAll, getTenantDb } from '../../db/tenantConnections.js';
import { hashPassword, verifyAccessToken } from '../../services/auth.service.js';

// El recuadro del login demo ofrece un admin Y un operario. La decisión de clonar mira el
// TENANT (isDemoTemplate), nunca el rol: si alguna vez se atara al rol, el operario entraría
// directo a la base compartida de la plantilla y lo que cargue ensuciaría la demo del próximo.

const DB_PLANTILLA = 'tenant_andescargo_operario';
let mongod;
let plantillaId;

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await connectControlPlane(uri);
  initBaseConnection(uri);

  const { Tenant, User } = getControlModels();
  await User.init();
  const plantilla = await Tenant.create({ name: 'Andes Cargo', dbName: DB_PLANTILLA, isDemoTemplate: true, tireCodePrefix: 'ANC-' });
  plantillaId = plantilla._id;
  await User.create({
    email: 'operario@andescargo.com',
    passwordHash: await hashPassword('tireops'),
    tenantId: plantilla._id,
    role: 'operator',
  });

  const { models } = getTenantDb(DB_PLANTILLA);
  await models.Vehicle.create({ brand: 'Scania', mobile: 'AC-01', licensePlate: 'AAA111', axles: [], tires: [] });
});

afterAll(async () => {
  await closeControlPlane();
  await closeAll();
  await mongod.stop();
});

describe('login demo · operario de la plantilla', () => {
  it('recibe una copia efímera propia, no la base de la plantilla', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'operario@andescargo.com', password: 'tireops' });

    expect(res.status).toBe(200);
    const claims = verifyAccessToken(res.body.accessToken);
    expect(claims.role).toBe('operator');
    expect(claims.dbName).not.toBe(DB_PLANTILLA);
    expect(claims.dbName).toMatch(/^tenant_demo_/);

    const { Tenant } = getControlModels();
    const clon = await Tenant.findById(claims.tenantId).lean();
    expect(String(clon.demoOf)).toBe(String(plantillaId));
    expect(clon.tireCodePrefix).toBe('ANC-');
  });

  it('ve los datos de Andes Cargo en su copia', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'operario@andescargo.com', password: 'tireops' });
    const vehiculos = await request(app).get('/api/vehicles').set('Authorization', `Bearer ${res.body.accessToken}`);

    expect(vehiculos.status).toBe(200);
    expect(vehiculos.body).toHaveLength(1);
    expect(vehiculos.body[0].mobile).toBe('AC-01');
  });
});
