// Seed de un tenant demo REALISTA con trazabilidad de ~6 meses. A diferencia de
// seed-tenant-fake.js (que inserta el estado final sin historial), este genera los
// movimientos a través de la CAPA DE SERVICIOS real (alta → asignar → desasignar →
// recapar → descartar), así el km acumulado, el ciclo de vida y TODOS los reportes
// quedan coherentes con cómo la app escribe. Después backdatea las fechas del historial
// para spread sobre la ventana (recalculateTireState solo depende del ORDEN, no de la
// fecha, así que backdatear preservando el orden no altera los estados ya calculados).
//
// Modela una empresa que "arranca a cargar de a poco": no vuelca toda su flota histórica,
// sino que registra desde las cubiertas nuevas en adelante, a lo largo de la ventana.
//
// Uso: cd backend && node scripts/seed-demo-realista.js
import mongoose from 'mongoose';
import { config } from 'dotenv';
import { connectControlPlane, closeControlPlane, getControlModels } from '../src/db/controlPlane.js';
import { initBaseConnection, getTenantDb, closeAll } from '../src/db/tenantConnections.js';
import { provisionTenant } from '../src/services/provision.service.js';
import { hashPassword } from '../src/services/auth.service.js';
import tireService from '../src/services/tire.service.js';
import { AXLE_PRESETS, generatePositions } from '../src/utils/axles.js';

config();

// ─── Config del tenant demo ───────────────────────────────────────────────────
const TENANT = { name: 'Andes Cargo', adminEmail: 'admin@andescargo.com', password: 'AndesAdmin25' };
const OPERATORS = [
  { email: 'operario1@andescargo.com', name: 'Juan Pérez', password: 'AndesOp01' },
  { email: 'operario2@andescargo.com', name: 'Carla Ruiz', password: 'AndesOp02' },
];

const DAY = 86400000;
const NOW = new Date();
const daysAgoMs = (d) => NOW.getTime() - d * DAY;

// PRNG determinista (reruns idénticos). Math.random serviría, pero esto hace el demo reproducible.
let _s = 987654321;
const rnd = () => { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; };
const randInt = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr, i) => arr[((i % arr.length) + arr.length) % arr.length];

const TIRE_BRANDS = ['Bridgestone', 'Michelin', 'Pirelli', 'Firestone', 'Goodyear', 'Fate', 'Continental'];
const SIZES = ['295/80 R22.5', '315/80 R22.5', '11R22.5', '275/80 R22.5', '295/75 R22.5'];
const PATTERNS = ['Con Taco', 'Liso', 'Mixto', 'Tracción', 'Direccional'];

// role: 'beast' (larga distancia, km enorme) · 'problem' (rota cubiertas rápido, km bajo) · 'normal'
const VEHICLES = [
  { mobile: 'Móvil 01', preset: 'camion_6x4', role: 'beast', brand: 'Scania R450' },
  { mobile: 'Móvil 02', preset: 'camion_4x2', role: 'problem', brand: 'Ford Cargo' },
  { mobile: 'Móvil 03', preset: 'camion_6x4', role: 'normal', brand: 'Volvo FH' },
  { mobile: 'Móvil 04', preset: 'camion_4x2', role: 'normal', brand: 'Mercedes Actros' },
  { mobile: 'Móvil 05', preset: 'semi_3', role: 'normal', brand: 'Semirremolque Randon' },
  { mobile: 'Móvil 06', preset: 'camion_6x4', role: 'normal', brand: 'Iveco Stralis' },
  { mobile: 'Móvil 07', preset: 'semi_3', role: 'normal', brand: 'Semirremolque Hermann' },
  { mobile: 'Móvil 08', preset: 'camion_4x2', role: 'normal', brand: 'VW Constellation' },
  { mobile: 'Móvil 09', preset: 'camion_6x4', role: 'normal', brand: 'DAF XF' },
  { mobile: 'Móvil 10', preset: 'semi_3', role: 'normal', brand: 'Semirremolque Montenegro' },
];

// Mezcla de ciclos de vida (cubre todos los estados/reportes). Se cicla sobre las cubiertas.
const ARCH_SEQ = [
  'depo', 'circ', 'ciclo', 'recap1_mount', 'recap2_stock', 'recap3_mount', 'descartada',
  'a_recapar', 'ciclo', 'circ', 'recap1_mount', 'depo', 'beast', 'recap2_stock', 'circ', 'ciclo',
];
const NUM_TIRES = 48;

// ─── Arranque ───────────────────────────────────────────────────────────────
if (!process.env.CONTROL_PLANE_URI || !process.env.MONGO_URI) {
  console.error('Faltan CONTROL_PLANE_URI / MONGO_URI en el .env');
  process.exit(1);
}
await connectControlPlane();
initBaseConnection(process.env.MONGO_URI);

const plate = (n) => (n % 2 === 1 ? `ABC-${300 + n}` : `AC${300 + n}CD`);

try {
  // 0) Idempotencia: si ya existe el tenant demo, limpiarlo para regenerar de cero.
  const { Tenant, User } = getControlModels();
  const existing = await Tenant.findOne({ name: TENANT.name });
  if (existing) {
    const dbn = existing.dbName;
    await User.deleteMany({ tenantId: existing._id });
    await Tenant.deleteOne({ _id: existing._id });
    if (dbn && dbn.startsWith('tenant_')) {
      const m = getTenantDb(dbn).models;
      await Promise.all([m.Tire.deleteMany({}), m.Vehicle.deleteMany({}), m.History.deleteMany({}), m.ReceiptCounter.deleteMany({})]);
    }
    console.log(`[seed] tenant demo previo encontrado — limpiado (${dbn})`);
  }

  // 1) Provisionar tenant + admin + operarios.
  const prov = await provisionTenant({ name: TENANT.name, adminEmail: TENANT.adminEmail, password: TENANT.password });
  for (const op of OPERATORS) {
    await User.create({
      email: op.email, name: op.name, passwordHash: await hashPassword(op.password),
      tenantId: prov.tenant._id, role: 'operator', mustChangePassword: false,
    });
  }
  const db = getTenantDb(prov.dbName).models;

  // 2) Vehículos (con ejes → posiciones reales para montar).
  const vehicles = [];
  for (let i = 0; i < VEHICLES.length; i++) {
    const spec = VEHICLES[i];
    const axles = AXLE_PRESETS[spec.preset].axles;
    const v = await db.Vehicle.create({ brand: spec.brand, mobile: spec.mobile, licensePlate: plate(i + 1), axles, tires: [] });
    vehicles.push({ id: String(v._id), role: spec.role, freePos: generatePositions(axles).map((p) => p.code), odo: randInt(60000, 240000) });
  }
  const beastIdx = vehicles.findIndex((v) => v.role === 'beast');

  // Numeración de comprobantes/órdenes (formato del sistema).
  let receiptN = 0; let orderN = 0;
  const nextReceipt = () => `0001-${String(++receiptN).padStart(8, '0')}`;
  const nextOrder = () => `0001-${String(++orderN).padStart(6, '0')}`;

  const kmForRole = (role) =>
    role === 'beast' ? randInt(180000, 460000) : role === 'problem' ? randInt(5000, 12000) : randInt(15000, 48000);

  let vehCounter = 0;
  const pickVeh = (arch) => (arch === 'beast' ? vehicles[beastIdx] : vehicles[1 + (vehCounter++ % (vehicles.length - 1))]);

  // Ejecuta un "período" cerrado (asignar + rodar + desasignar) en un vehículo.
  const stint = async (tireId, arch) => {
    const v = pickVeh(arch);
    const pos = v.freePos.length ? v.freePos.shift() : null;
    await tireService.assignVehicle(db, tireId, v.id, v.odo, nextOrder(), nextReceipt(), pos);
    v.odo += kmForRole(v.role);
    await tireService.unassignVehicle(db, tireId, v.odo, nextOrder(), nextReceipt());
    if (pos) v.freePos.push(pos);
  };
  // Deja la cubierta MONTADA (período abierto): suma a "en circulación" y a "montadas".
  const mount = async (tireId, arch) => {
    const v = pickVeh(arch);
    const pos = v.freePos.length ? v.freePos.shift() : null;
    await tireService.assignVehicle(db, tireId, v.id, v.odo, nextOrder(), nextReceipt(), pos);
    // no se devuelve la posición: queda ocupada
  };
  const setStatus = (tireId, status) => tireService.updateTireStatus(db, tireId, status, nextOrder(), nextReceipt());
  // Recapado: se marca "A recapar" y luego se recapó al siguiente nivel de stock.
  const recapTo = async (tireId, level) => { await setStatus(tireId, 'A recapar'); await setStatus(tireId, level); };

  // 3) Cubiertas + su ciclo de vida.
  const meta = []; // { id, onboardDaysAgo } para backdatear
  let code = 1000;
  for (let i = 0; i < NUM_TIRES; i++) {
    code += 1;
    const t = await tireService.createTire(db, {
      status: 'Nueva', code, brand: pick(TIRE_BRANDS, i * 3 + 1), pattern: pick(PATTERNS, i),
      size: pick(SIZES, i * 2 + 1), serialNumber: `AC-${code}`, receiptNumber: nextReceipt(), orderNumber: nextOrder(),
    });
    const id = String(t._id);
    const arch = pick(ARCH_SEQ, i);

    if (arch === 'circ') { await mount(id, arch); }
    else if (arch === 'ciclo') { await stint(id, arch); }
    else if (arch === 'beast') { await stint(id, 'beast'); }
    else if (arch === 'recap1_mount') { await stint(id, arch); await recapTo(id, '1er Recapado'); await mount(id, arch); }
    else if (arch === 'recap2_stock') { await stint(id, arch); await recapTo(id, '1er Recapado'); await stint(id, arch); await recapTo(id, '2do Recapado'); }
    else if (arch === 'recap3_mount') {
      await stint(id, arch); await recapTo(id, '1er Recapado'); await stint(id, arch);
      await recapTo(id, '2do Recapado'); await stint(id, arch); await recapTo(id, '3er Recapado'); await mount(id, arch);
    } else if (arch === 'descartada') {
      await stint(id, arch); await recapTo(id, '1er Recapado'); await stint(id, arch); await recapTo(id, '2do Recapado');
      await stint(id, arch); await recapTo(id, '3er Recapado'); await stint(id, arch); await setStatus(id, 'A recapar'); await setStatus(id, 'Descartada');
    } else if (arch === 'a_recapar') {
      await stint(id, arch); await recapTo(id, '1er Recapado'); await stint(id, arch); await setStatus(id, 'A recapar'); await stint(id, arch);
    }
    // 'depo' → sin movimientos (queda Nueva en depósito).

    const onboardDaysAgo = Math.max(28, 182 - i * 3);
    meta.push({ id, onboardDaysAgo });
  }

  // 4) Backdatear fechas del historial (spread sobre la ventana, orden preservado).
  const histOps = [];
  const tireOps = [];
  for (const m of meta) {
    const entries = await db.History.find({ tire: m.id }).sort({ _id: 1 }).select('_id').lean();
    const M = entries.length;
    const startMs = daysAgoMs(m.onboardDaysAgo);
    const endMs = Math.max(daysAgoMs(randInt(3, 45)), startMs + M * DAY);
    entries.forEach((e, k) => {
      const date = new Date(M <= 1 ? startMs : Math.round(startMs + (endMs - startMs) * (k / (M - 1))));
      histOps.push({ updateOne: { filter: { _id: e._id }, update: { $set: { date } } } });
    });
    const last = new Date(M <= 1 ? startMs : endMs);
    // Vía driver NATIVO: createdAt es inmutable con timestamps de mongoose (un $set por el
    // ODM se ignora). El driver nativo escribe el campo directo. _id debe ser ObjectId.
    tireOps.push({ updateOne: { filter: { _id: new mongoose.Types.ObjectId(m.id) }, update: { $set: { createdAt: new Date(startMs), updatedAt: last } } } });
  }
  if (histOps.length) await db.History.bulkWrite(histOps);
  if (tireOps.length) await db.Tire.collection.bulkWrite(tireOps);

  // 5) Dejar el contador de comprobantes coherente con lo emitido.
  await db.ReceiptCounter.findOneAndUpdate({ pointOfSale: 1 }, { $set: { currentNumber: receiptN } }, { upsert: true });

  // Resumen.
  const tires = await db.Tire.find().select('status vehicle brand').lean();
  const byStatus = {};
  for (const t of tires) byStatus[t.status] = (byStatus[t.status] || 0) + 1;
  const histCount = await db.History.countDocuments();
  console.log('\n✅ Tenant demo realista creado:');
  console.log('   Empresa:  ', prov.tenant.name, `(db: ${prov.dbName})`);
  console.log('   Admin:    ', TENANT.adminEmail, '/', TENANT.password);
  OPERATORS.forEach((o) => console.log('   Operario: ', o.email, '/', o.password));
  console.log(`   Vehículos: ${vehicles.length} · Cubiertas: ${tires.length} · Movimientos: ${histCount}`);
  console.log('   Por estado:', JSON.stringify(byStatus));
  console.log(`   En circulación: ${tires.filter((t) => t.vehicle).length} · En depósito: ${tires.filter((t) => !t.vehicle).length}`);
} catch (e) {
  console.error('\n❌ Error:', e.message);
  console.error(e.stack);
  process.exitCode = 1;
} finally {
  await closeControlPlane();
  await closeAll();
}
