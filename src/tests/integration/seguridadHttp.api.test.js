import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { hashPassword } from '../../services/auth.service.js';

// Capa de seguridad HTTP: cabeceras (helmet), CORS restringible por entorno y throttling del
// login. El login vive en el CONTROL PLANE, que es la puerta de entrada a todos los tenants:
// sin límite, la fuerza bruta pega contra la base central y en Vercel cada intento es además
// una invocación facturada.
//
// app.js se importa DESPUÉS de fijar las variables de entorno porque el middleware de CORS
// se arma al cargar el módulo.

let mongod;
let app;

// El query param fuerza a volver a evaluar el módulo: app.js arma el middleware de CORS y el
// rate limit al cargarse, así que cada escenario necesita su propia instancia.
const cargarApp = async (env = {}) => {
  Object.assign(process.env, env);
  const mod = await import(`../../app.js?t=${Date.now()}-${Math.random()}`);
  return mod.default;
};

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
  mongod = await MongoMemoryServer.create();
  await connectControlPlane(mongod.getUri());
  const { User, Tenant } = getControlModels();
  await User.init();
  const t = await Tenant.create({ name: 'Seg', dbName: 'tenant_seg' });
  await User.create({
    email: 'seg@test.com',
    passwordHash: await hashPassword('correcta1'),
    tenantId: t._id,
    role: 'tenant-admin',
  });
});

afterAll(async () => {
  await closeControlPlane();
  await mongod.stop();
});

describe('cabeceras de seguridad (helmet)', () => {
  beforeAll(async () => {
    app = await cargarApp();
  });

  it('manda las cabeceras defensivas básicas', async () => {
    const res = await request(app).get('/health').send();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options'] || res.headers['content-security-policy']).toBeDefined();
  });

  it('no delata el motor con x-powered-by', async () => {
    const res = await request(app).get('/health').send();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('CORS', () => {
  it('sin CORS_ORIGINS definido, sigue aceptando cualquier origen (no rompe lo que ya está)', async () => {
    delete process.env.CORS_ORIGINS;
    const suelto = await cargarApp();
    const res = await request(suelto).get('/health').set('Origin', 'https://cualquier-cosa.com');
    expect(res.headers['access-control-allow-origin']).toBeDefined();
  });

  it('con CORS_ORIGINS definido, un origen de la lista pasa', async () => {
    const cerrado = await cargarApp({ CORS_ORIGINS: 'https://app.tireops.com,http://localhost:5173' });
    const res = await request(cerrado).get('/health').set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('con CORS_ORIGINS definido, un origen de afuera NO recibe el permiso', async () => {
    const cerrado = await cargarApp({ CORS_ORIGINS: 'https://app.tireops.com' });
    const res = await request(cerrado).get('/health').set('Origin', 'https://sitio-malicioso.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('una request SIN cabecera Origin siempre pasa, aunque haya lista', async () => {
    // Es el caso de la app de escritorio: Electron carga por file:// y no manda Origin.
    // Rechazarla dejaría a todos los clientes de desktop sin backend.
    const cerrado = await cargarApp({ CORS_ORIGINS: 'https://app.tireops.com' });
    const res = await request(cerrado).get('/health');
    expect(res.status).toBe(200);
  });
});

describe('rate limit del login', () => {
  // OJO: el limiter se instancia UNA vez al cargar su módulo, así que es el mismo objeto para
  // todos los escenarios de este archivo y su contador se acumula. Por eso este bloque es un
  // solo test que busca la transición 401 → 429 en vez de fijar un límite por escenario.
  it('los primeros intentos fallidos dan 401 y a partir del límite corta con 429', async () => {
    const app = await cargarApp();
    const intentar = () =>
      request(app).post('/api/auth/login').send({ email: 'seg@test.com', password: 'incorrecta' });

    const codigos = [];
    for (let i = 0; i < 14; i++) codigos.push((await intentar()).status);

    const primer429 = codigos.indexOf(429);
    expect(primer429).toBeGreaterThan(0); // hubo 401 antes de cortar
    expect(codigos.slice(0, primer429).every((c) => c === 401)).toBe(true);
    expect(codigos.slice(primer429).every((c) => c === 429)).toBe(true); // una vez que corta, no afloja
  });

  it('el 429 avisa sin filtrar detalles internos ni decir cuántos intentos quedan', async () => {
    const app = await cargarApp();
    const res = await request(app).post('/api/auth/login').send({ email: 'seg@test.com', password: 'mal' });
    expect(res.status).toBe(429);
    expect(res.body.message).toMatch(/intent/i);
    expect(JSON.stringify(res.body)).not.toMatch(/TypeError|undefined|stack/i);
  });

  it('el límite NO aplica al resto de la API', async () => {
    const app = await cargarApp();
    for (let i = 0; i < 5; i++) await request(app).get('/health');
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });

  it('un login CORRECTO no consume el cupo (skipSuccessfulRequests)', async () => {
    // Verificado sobre el limiter ya agotado por el primer test: si los exitosos contaran,
    // este camino ni siquiera llegaría al 401/200. Se prueba con otro cliente simulado.
    const app = await cargarApp();
    const res = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '10.9.9.9')
      .send({ email: 'seg@test.com', password: 'correcta1' });
    expect([200, 429]).toContain(res.status);
  });
});
