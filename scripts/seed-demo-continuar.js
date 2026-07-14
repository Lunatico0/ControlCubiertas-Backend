// APPENDEA ~6 meses más de operaciones al tenant demo Andes Cargo, SIN borrar lo anterior.
// Complementa a seed-demo-realista.js (que sí limpia y regenera). Genera los movimientos por la
// capa de servicios (alta/asignar/desasignar/recapar/descartar) para mantener km, posiciones y
// estados coherentes, y backdatea el historial NUEVO hacia adelante (~6 meses) sin tocar el viejo.
//
// Uso: cd backend && node scripts/seed-demo-continuar.js
import mongoose from 'mongoose';
import { config } from 'dotenv'; config();
import { initBaseConnection, getTenantDb, closeAll } from '../src/db/tenantConnections.js';
import tireService from '../src/services/tire.service.js';
import { generatePositions } from '../src/utils/axles.js';

const DB = 'tenant_andes_cargo';
const DAY = 86400000;
const NOW = new Date();

let _s = 20260714;
const rnd = () => { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr, i) => arr[((i % arr.length) + arr.length) % arr.length];

const LADDER = ['Nueva', '1er Recapado', '2do Recapado', '3er Recapado']; // escalera initial+stock
const nextStock = (status) => { const i = LADDER.indexOf(status); return i >= 0 && i < LADDER.length - 1 ? LADDER[i + 1] : null; };
const BRANDS = ['Bridgestone', 'Michelin', 'Pirelli', 'Firestone', 'Goodyear', 'Fate', 'Continental'];
const SIZES = ['295/80 R22.5', '315/80 R22.5', '11R22.5', '275/80 R22.5', '295/75 R22.5'];
const PATTERNS = ['Con Taco', 'Liso', 'Mixto', 'Tracción', 'Direccional'];

if (!process.env.MONGO_URI) { console.error('Falta MONGO_URI'); process.exit(1); }
initBaseConnection(process.env.MONGO_URI);
const db = getTenantDb(DB).models;

try {
  const tenantTires = await db.Tire.find().lean();
  if (!tenantTires.length) { console.error(`El tenant ${DB} está vacío — corré primero seed-demo-realista.js`); process.exit(1); }

  const runStart = new Date(); // marca para identificar el historial nuevo (por createdAt)
  const vehicles = await db.Vehicle.find().select('_id mobile axles').lean();

  // Posiciones ocupadas HOY por cubiertas montadas → no se usan para períodos nuevos.
  const occupied = new Set();
  for (const t of tenantTires) if (t.vehicle && t.position) occupied.add(`${t.vehicle}|${t.position}`);
  const vehState = vehicles
    .map((v) => ({ id: String(v._id), free: generatePositions(v.axles || []).map((p) => p.code).filter((c) => !occupied.has(`${String(v._id)}|${c}`)), odo: ri(260000, 520000) }))
    .filter((v) => v.free.length);
  if (!vehState.length) { console.error('No hay posiciones libres para operar.'); process.exit(1); }

  const rc = await db.ReceiptCounter.findOne({ pointOfSale: 1 });
  let receiptN = rc?.currentNumber || 0;
  let orderN = 5000;
  const nextReceipt = () => `0001-${String(++receiptN).padStart(8, '0')}`;
  const nextOrder = () => `0001-${String(++orderN).padStart(6, '0')}`;

  const touched = new Set();
  let vehCur = 0;
  const pickVeh = () => { for (let k = 0; k < vehState.length; k++) { const v = vehState[vehCur++ % vehState.length]; if (v.free.length) return v; } return null; };

  // Un período cerrado (asignar → rodar → desasignar) en una posición libre.
  const stint = async (tireId, lo = 15000, hi = 45000) => {
    const v = pickVeh(); if (!v) return;
    const p = v.free.shift();
    await tireService.assignVehicle(db, tireId, v.id, v.odo, nextOrder(), nextReceipt(), p);
    v.odo += ri(lo, hi);
    await tireService.unassignVehicle(db, tireId, v.odo, nextOrder(), nextReceipt());
    v.free.push(p);
    touched.add(String(tireId));
  };
  const setStatus = async (tireId, status) => { await tireService.updateTireStatus(db, tireId, status, nextOrder(), nextReceipt()); touched.add(String(tireId)); };
  const recap = async (tireId, to) => { await setStatus(tireId, 'A recapar'); await setStatus(tireId, to); };

  // 1) Cubiertas nuevas (la carga sigue creciendo): 12, con 1-2 períodos.
  let code = Math.max(1048, ...tenantTires.map((t) => t.code || 0));
  let nuevas = 0;
  for (let i = 0; i < 12; i++) {
    code += 1;
    const t = await tireService.createTire(db, { status: 'Nueva', code, brand: pick(BRANDS, i * 3 + 2), pattern: pick(PATTERNS, i), size: pick(SIZES, i * 2 + 1), serialNumber: `AC-${code}`, receiptNumber: nextReceipt(), orderNumber: nextOrder() });
    touched.add(String(t._id));
    await stint(String(t._id));
    if (i % 3 === 0) { await recap(String(t._id), '1er Recapado'); await stint(String(t._id)); }
    nuevas += 1;
  }

  // 2) Cubiertas en stock (no montadas, no descartadas): otro período; algunas recapan o se descartan.
  const stock = tenantTires.filter((t) => !t.vehicle && t.status !== 'Descartada');
  let recaps = 0; let bajas = 0;
  for (let i = 0; i < stock.length; i++) {
    const t = stock[i]; const id = String(t._id);
    await stint(id);
    const r = i % 4;
    if (r === 0) { const nx = nextStock(t.status); if (nx) { await recap(id, nx); await stint(id); recaps += 1; } }
    else if (r === 1 && t.status === '3er Recapado') { await setStatus(id, 'A recapar'); await setStatus(id, 'Descartada'); bajas += 1; }
  }

  // 3) Backdatear SOLO el historial nuevo, hacia adelante (~6 meses), monótono por cubierta.
  const histOps = [];
  const tireOps = [];
  for (const id of touched) {
    const entries = await db.History.find({ tire: id, createdAt: { $gte: runStart } }).sort({ _id: 1 }).select('_id').lean();
    if (!entries.length) continue;
    const start = NOW.getTime() + ri(2, 90) * DAY;
    const span = ri(40, 150) * DAY;
    entries.forEach((e, k) => {
      const date = new Date(entries.length <= 1 ? start : Math.round(start + span * (k / (entries.length - 1))));
      histOps.push({ updateOne: { filter: { _id: e._id }, update: { $set: { date } } } });
    });
    const last = new Date(entries.length <= 1 ? start : start + span);
    tireOps.push({ updateOne: { filter: { _id: new mongoose.Types.ObjectId(id) }, update: { $set: { updatedAt: last } } } });
  }
  if (histOps.length) await db.History.bulkWrite(histOps);
  if (tireOps.length) await db.Tire.collection.bulkWrite(tireOps);
  await db.ReceiptCounter.findOneAndUpdate({ pointOfSale: 1 }, { $set: { currentNumber: receiptN } }, { upsert: true });

  const totalTires = await db.Tire.countDocuments();
  const totalHist = await db.History.countDocuments();
  console.log(`\n✅ +6 meses de operaciones en ${DB} (sin borrar lo anterior):`);
  console.log(`   Cubiertas nuevas: ${nuevas} · recapadas: ${recaps} · nuevas bajas: ${bajas} · cubiertas afectadas: ${touched.size}`);
  console.log(`   Totales ahora → cubiertas: ${totalTires} · movimientos: ${totalHist}`);
} catch (e) {
  console.error('\n❌ Error:', e.message);
  console.error(e.stack);
  process.exitCode = 1;
} finally {
  await closeAll();
}
