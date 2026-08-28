import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { connectControlPlane, getControlModels, closeControlPlane } from '../../db/controlPlane.js';
import { initBaseConnection, getTenantDb, closeAll } from '../../db/tenantConnections.js';
import { hashPassword, signAccessToken } from '../../services/auth.service.js';
import { getTenantReceipts } from '../../services/receipts.service.js';
import { getVehicleReports, getVehicleWear } from '../../services/reports.service.js';
import TireService from '../../services/tire.service.js';
import HistoryModel from '../../models/history.model.js';
import TireModel from '../../models/tire.model.js';

// Hallazgos de la auditoría de backend agrupados: fallback de estado por rol (t18),
// reportes que ignoraban los movimientos corregidos (t19), el switch de undo sobre un type
// ya mutado (t21), índices del data plane (t22), paginación en Mongo del histórico de
// comprobantes (t23), casteo de req.query.type (t24), revalidación del dbName del token
// (t25), límite del body parser (t26) y Swagger fuera de producción (t27).

let mongod;

const cargarApp = async (env = {}) => {
  Object.assign(process.env, env);
  const mod = await import(`../../app.js?t=${Date.now()}-${Math.random()}`);
  return mod.default;
};

const statuses = [
  { name: '0 km', role: 'initial' },
  { name: '1er Recapado', role: 'stock' },
  { name: 'A recapar', role: 'recap' },
  { name: 'Fuera de servicio', role: 'discard' },
];

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
  mongod = await MongoMemoryServer.create();
  await connectControlPlane(mongod.getUri());
  initBaseConnection(mongod.getUri());
});

afterAll(async () => {
  await closeAll();
  await closeControlPlane();
  await mongod.stop();
});

// ─────────────────────────────────────────────────────────────────────────────
// t18 · El estado de reversión sale del ROL, nunca del literal "Nueva"
// ─────────────────────────────────────────────────────────────────────────────
describe('undoHistoryEntry: el estado de reversión se resuelve por rol (t18)', () => {
  const dbName = 'tenant_undo_rol';
  let db;

  beforeAll(() => {
    db = getTenantDb(dbName).models;
  });

  it('revierte al estado con rol initial del tenant, no al literal "Nueva"', async () => {
    const tire = await db.Tire.create({
      status: 'A recapar', code: 9001, brand: 'B', pattern: 'P', size: 'S', serialNumber: 'SN9001',
    });
    // Único movimiento previo: un cambio de Estado SIN entrada anterior con status,
    // que es exactamente el camino que caía en el fallback hardcodeado.
    const cambio = await db.History.create({
      tire: tire._id, type: 'Estado', status: 'A recapar', orderNumber: '10',
      date: new Date(2026, 0, 5), receiptNumber: '0000-00000000',
    });

    const { tire: after } = await TireService.undoHistoryEntry(
      db, tire._id.toString(), cambio._id.toString(), { orderNumber: '11' }, statuses,
    );

    expect(after.status).toBe('0 km');
    const revertido = await db.History.findOne({ corrects: cambio._id, type: 'Estado' });
    expect(revertido.status).toBe('0 km');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// t21 · El switch de undo/correct razona sobre el tipo ORIGINAL, no el mutado
// ─────────────────────────────────────────────────────────────────────────────
describe('undoHistoryEntry: el switch usa el tipo original (t21)', () => {
  const dbName = 'tenant_undo_switch';
  let db;

  beforeAll(() => {
    db = getTenantDb(dbName).models;
  });

  it('deshacer una Asignación desasigna la cubierta y marca el original como Corrección-Asignación', async () => {
    const veh = await db.Vehicle.create({ brand: 'Scania', mobile: 'M91', licensePlate: 'AA111AA', tires: [] });
    const tire = await db.Tire.create({
      status: '0 km', code: 9101, brand: 'B', pattern: 'P', size: 'S', serialNumber: 'SN9101',
    });
    await db.History.create({
      tire: tire._id, type: 'Alta', status: '0 km', kmAlta: 0,
      date: new Date(2026, 0, 1), receiptNumber: '0000-00000000',
    });
    const asig = await db.History.create({
      tire: tire._id, type: 'Asignación', vehicle: veh._id, kmAlta: 1000, status: '0 km',
      orderNumber: '20', date: new Date(2026, 0, 2), receiptNumber: '0000-00000000',
    });
    tire.vehicle = veh._id;
    await tire.save();
    veh.tires = [tire._id];
    await veh.save();

    const { tire: after } = await TireService.undoHistoryEntry(
      db, tire._id.toString(), asig._id.toString(), { orderNumber: '21' }, statuses,
    );

    expect(after.vehicle).toBeFalsy();
    const original = await db.History.findById(asig._id);
    expect(original.type).toBe('Corrección-Asignación');
    const generado = await db.History.findOne({ corrects: asig._id });
    expect(generado.type).toBe('Desasignación');
  });

  it('deshacer una Desasignación reasigna al vehículo anterior', async () => {
    const veh = await db.Vehicle.create({ brand: 'Volvo', mobile: 'M92', licensePlate: 'AA222AA', tires: [] });
    const tire = await db.Tire.create({
      status: '0 km', code: 9102, brand: 'B', pattern: 'P', size: 'S', serialNumber: 'SN9102',
    });
    await db.History.create({
      tire: tire._id, type: 'Alta', status: '0 km', kmAlta: 0,
      date: new Date(2026, 0, 1), receiptNumber: '0000-00000000',
    });
    await db.History.create({
      tire: tire._id, type: 'Asignación', vehicle: veh._id, kmAlta: 500, status: '0 km',
      orderNumber: '30', date: new Date(2026, 0, 2), receiptNumber: '0000-00000000',
    });
    const desas = await db.History.create({
      tire: tire._id, type: 'Desasignación', vehicle: null, kmAlta: 500, kmBaja: 1500, km: 1000,
      status: '0 km', orderNumber: '31', date: new Date(2026, 0, 3), receiptNumber: '0000-00000000',
    });

    const { tire: after } = await TireService.undoHistoryEntry(
      db, tire._id.toString(), desas._id.toString(), { orderNumber: '32' }, statuses,
    );

    expect(String(after.vehicle?._id || after.vehicle)).toBe(String(veh._id));
    const original = await db.History.findById(desas._id);
    expect(original.type).toBe('Corrección-Desasignación');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// t19 · Los reportes cuentan también los movimientos corregidos
// ─────────────────────────────────────────────────────────────────────────────
describe('reports: los movimientos Corrección-* también suman (t19)', () => {
  const dbName = 'tenant_reportes_correccion';
  let db;

  beforeAll(async () => {
    db = getTenantDb(dbName).models;
    const veh = await db.Vehicle.create({
      brand: 'Scania', mobile: 'M80', licensePlate: 'BB111BB', tires: [],
      axles: [{ type: 'simple', positions: 2 }],
    });
    const tire = await db.Tire.create({
      status: '0 km', code: 9201, brand: 'B', pattern: 'P', size: 'S', serialNumber: 'SN9201',
    });
    // Período cerrado cuyos DOS extremos quedaron como Corrección-*: hoy desaparece del reporte.
    await db.History.create({
      tire: tire._id, type: 'Corrección-Asignación', vehicle: veh._id, kmAlta: 0, position: 'E1-I',
      status: '0 km', date: new Date(2026, 0, 1), receiptNumber: '0000-00000000',
    });
    await db.History.create({
      tire: tire._id, type: 'Corrección-Desasignación', vehicle: null, kmAlta: 0, kmBaja: 5000, km: 5000,
      status: '0 km', date: new Date(2026, 0, 2), receiptNumber: '0000-00000000',
    });
    global.__vehCorreccion = veh._id.toString();
  });

  it('getVehicleReports suma el km de un período con extremos corregidos', async () => {
    const rep = await getVehicleReports(dbName, statuses);
    const fila = rep.vehicles.find((v) => v.mobile === 'M80');
    expect(fila.kmTotal).toBe(5000);
    expect(fila.stints).toBe(1);
  });

  it('getVehicleWear atribuye el km a la posición aunque el movimiento esté corregido', async () => {
    const wear = await getVehicleWear(dbName, global.__vehCorreccion, statuses);
    const pos = wear.positions.find((p) => p.code === 'E1-I');
    expect(pos.km).toBe(5000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// t22 · Índices explícitos en el data plane
// ─────────────────────────────────────────────────────────────────────────────
describe('índices del data plane (t22)', () => {
  const claves = (schema) => schema.indexes().map(([def]) => Object.keys(def).join(','));

  it('History indexa tire+date, type y vehicle', () => {
    const idx = claves(HistoryModel.schema);
    expect(idx).toContain('tire,date');
    expect(idx).toContain('type');
    expect(idx).toContain('vehicle');
  });

  it('Tire indexa vehicle y status', () => {
    const idx = claves(TireModel.schema);
    expect(idx).toContain('vehicle');
    expect(idx).toContain('status');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// t23 + t24 · Histórico de comprobantes: paginado en Mongo y type casteado
// ─────────────────────────────────────────────────────────────────────────────
describe('getTenantReceipts: paginación en Mongo y filtro seguro (t23, t24)', () => {
  const dbName = 'tenant_receipts_pag';
  let db;

  beforeAll(async () => {
    db = getTenantDb(dbName).models;
    const veh = await db.Vehicle.create({ brand: 'Iveco', mobile: 'M70', licensePlate: 'CC111CC', tires: [] });
    const tire = await db.Tire.create({
      status: '0 km', code: 9301, brand: 'B', pattern: 'P', size: 'S', serialNumber: 'SN9301',
    });
    for (let i = 1; i <= 25; i += 1) {
      await db.History.create({
        tire: tire._id, type: i % 2 === 0 ? 'Alta' : 'Asignación', vehicle: veh._id,
        receiptNumber: `0001-${String(i).padStart(8, '0')}`,
        date: new Date(2026, 0, i), editedBy: 'ana',
      });
    }
  });

  it('no trae de Mongo más filas que las de la página pedida', async () => {
    // Se envuelve History.find para inspeccionar las opciones REALES de la query: sin skip/limit
    // en Mongo, el servicio traía el histórico completo y paginaba con slice() en memoria.
    const original = db.History.find.bind(db.History);
    const opciones = [];
    db.History.find = (...args) => {
      const q = original(...args);
      const then = q.then.bind(q);
      q.then = (...t) => { opciones.push(q.getOptions()); return then(...t); };
      return q;
    };
    try {
      const { items, total } = await getTenantReceipts(dbName, { page: 1, limit: 5 });
      expect(items).toHaveLength(5);
      expect(total).toBe(25);
      expect(opciones.some((o) => o.limit === 5 && o.skip === 0)).toBe(true);
    } finally {
      db.History.find = original;
    }
  });

  it('la segunda página devuelve filas distintas de la primera', async () => {
    const p1 = await getTenantReceipts(dbName, { page: 1, limit: 5 });
    const p2 = await getTenantReceipts(dbName, { page: 2, limit: 5 });
    expect(p2.items).toHaveLength(5);
    expect(p1.items.map((i) => i.numero)).not.toEqual(p2.items.map((i) => i.numero));
  });

  it('descarta un type que no sea string (operator injection)', async () => {
    const { total } = await getTenantReceipts(dbName, { type: { $ne: 'Alta' }, page: 1, limit: 5 });
    expect(total).toBe(25);
  });

  it('filtra por type cuando es un string válido', async () => {
    const { total } = await getTenantReceipts(dbName, { type: 'Alta', page: 1, limit: 50 });
    expect(total).toBe(12);
  });

  it('la búsqueda cross-field sigue funcionando junto con la paginación', async () => {
    const { items, total } = await getTenantReceipts(dbName, { q: 'CC111CC', page: 1, limit: 10 });
    expect(total).toBe(25);
    expect(items).toHaveLength(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// t25 · requireActiveTenant revalida el dbName firmado en el token
// ─────────────────────────────────────────────────────────────────────────────
describe('requireActiveTenant revalida el dbName del token (t25)', () => {
  let app;
  let tenant;

  beforeAll(async () => {
    app = await cargarApp();
    const { Tenant, User } = getControlModels();
    tenant = await Tenant.create({ name: 'Cutover', dbName: 'tenant_cutover_nuevo' });
    await User.create({
      email: 'cutover@test.com', passwordHash: await hashPassword('pass'),
      tenantId: tenant._id, role: 'tenant-admin',
    });
  });

  it('rechaza con 403 TENANT_INACTIVE un token cuyo dbName ya no coincide', async () => {
    const token = signAccessToken({
      userId: String(tenant._id), tenantId: String(tenant._id),
      dbName: 'tenant_cutover_viejo', role: 'tenant-admin',
    });
    const res = await request(app).get('/api/tires').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TENANT_INACTIVE');
  });

  it('deja pasar el token cuyo dbName coincide', async () => {
    const token = signAccessToken({
      userId: String(tenant._id), tenantId: String(tenant._id),
      dbName: 'tenant_cutover_nuevo', role: 'tenant-admin',
    });
    const res = await request(app).get('/api/tires').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// t26 · Límite del body parser y 413 en JSON
// ─────────────────────────────────────────────────────────────────────────────
describe('body parser: límite explícito y error JSON (t26)', () => {
  let app;

  beforeAll(async () => {
    app = await cargarApp();
  });

  it('acepta un payload de ~1 MB (logo en dataURL)', async () => {
    const { Tenant, User } = getControlModels();
    const t = await Tenant.create({ name: 'Logo', dbName: 'tenant_logo_limit' });
    await User.create({
      email: 'logo@test.com', passwordHash: await hashPassword('pass'),
      tenantId: t._id, role: 'tenant-admin',
    });
    const token = signAccessToken({
      userId: String(t._id), tenantId: String(t._id), dbName: t.dbName, role: 'tenant-admin',
    });
    const logo = `data:image/png;base64,${'A'.repeat(1_000_000)}`;
    const res = await request(app)
      .patch('/api/admin/company')
      .set('Authorization', `Bearer ${token}`)
      .send({ receiptDesign: { logo } });
    expect(res.status).not.toBe(413);
  });

  it('devuelve 413 en JSON (no el HTML de Express) cuando el body excede el límite', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send({ email: 'x@y.z', password: 'A'.repeat(3_000_000) });
    expect(res.status).toBe(413);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.message).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// t27 · Swagger sólo fuera de producción
// ─────────────────────────────────────────────────────────────────────────────
describe('Swagger no se monta en producción (t27)', () => {
  const nodeEnvOriginal = process.env.NODE_ENV;

  afterAll(() => {
    process.env.NODE_ENV = nodeEnvOriginal;
  });

  it('sirve /api-docs.json fuera de producción', async () => {
    const app = await cargarApp({ NODE_ENV: 'test' });
    const res = await request(app).get('/api-docs.json');
    expect(res.status).toBe(200);
  });

  it('devuelve 404 en /api-docs y /api-docs.json con NODE_ENV=production', async () => {
    const app = await cargarApp({ NODE_ENV: 'production' });
    expect((await request(app).get('/api-docs.json')).status).toBe(404);
    expect((await request(app).get('/api-docs/')).status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// t39 · El endpoint raíz reporta la versión REAL del paquete
// ─────────────────────────────────────────────────────────────────────────────
describe('GET / reporta la versión del package.json (t39)', () => {
  it('no devuelve una versión hardcodeada', async () => {
    const app = await cargarApp();
    const { readFileSync } = await import('node:fs');
    const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(pkg.version);
  });

  it('el nombre del producto es TireOps', async () => {
    const app = await cargarApp();
    const res = await request(app).get('/');
    expect(res.body.message).toMatch(/TireOps/i);
  });
});
