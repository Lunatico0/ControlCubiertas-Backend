// REPARA fechas futuras en el tenant demo Andes Cargo (bug: seed-demo-continuar.js viejo
// backdateaba el historial NUEVO hacia el futuro). Como recalculateTireState reproduce el
// historial ordenando por `date`, cualquier evento en el futuro rompe el estado de las
// operaciones reales hechas "hoy". Este script hace un SHIFT UNIFORME de todas las fechas
// del historial (+ timestamps de cubiertas) hacia atrás, de modo que el máximo quede ~3 días
// en el pasado, preservando orden relativo y espaciado. Idempotente: si no hay fechas futuras,
// no hace nada.
//
// Uso: cd backend && node scripts/repair-demo-dates.js
import { config } from 'dotenv'; config();
import { initBaseConnection, getTenantDb, closeAll } from '../src/db/tenantConnections.js';

const DB = 'tenant_andes_cargo';
const DAY = 86400000;
const NOW = new Date();
const BUFFER = 3 * DAY; // el máximo queda 3 días en el pasado

if (!process.env.MONGO_URI) { console.error('Falta MONGO_URI'); process.exit(1); }
initBaseConnection(process.env.MONGO_URI);
const db = getTenantDb(DB).models;

try {
  const maxDoc = await db.History.find().sort({ date: -1 }).limit(1).select('date').lean();
  const maxDate = maxDoc[0]?.date ? new Date(maxDoc[0].date) : null;
  if (!maxDate) { console.log(`${DB}: sin historial, nada que reparar.`); await closeAll(); process.exit(0); }

  const futureCount = await db.History.countDocuments({ date: { $gt: NOW } });
  const cutoff = NOW.getTime() - BUFFER;
  const offset = maxDate.getTime() - cutoff;

  console.log(`\n🔎 ${DB}`);
  console.log(`   Fecha máxima actual : ${maxDate.toISOString()}`);
  console.log(`   Hoy                 : ${NOW.toISOString()}`);
  console.log(`   Entradas futuras    : ${futureCount}`);

  if (offset <= 0) { console.log(`\n✅ No hay fechas futuras (offset=${offset}ms). Nada que hacer.`); await closeAll(); process.exit(0); }

  console.log(`   Offset a restar     : ${Math.round(offset / DAY)} días`);

  // Shift uniforme server-side (aggregation pipeline update). Preserva orden y espaciado.
  const shift = (field) => ({ $set: { [field]: { $subtract: [`$${field}`, offset] } } });
  const hres = await db.History.updateMany({}, [shift('date')]);
  // Tire.createdAt/updatedAt son inmutables vía ODM → driver nativo.
  const tres = await db.Tire.collection.updateMany({ updatedAt: { $exists: true } }, [shift('updatedAt')]);
  const cres = await db.Tire.collection.updateMany({ createdAt: { $exists: true } }, [shift('createdAt')]);

  const newMax = (await db.History.find().sort({ date: -1 }).limit(1).select('date').lean())[0]?.date;
  const stillFuture = await db.History.countDocuments({ date: { $gt: NOW } });

  console.log(`\n✅ Reparado:`);
  console.log(`   History.date actualizadas : ${hres.modifiedCount}`);
  console.log(`   Tire.updatedAt            : ${tres.modifiedCount}`);
  console.log(`   Tire.createdAt            : ${cres.modifiedCount}`);
  console.log(`   Nueva fecha máxima        : ${new Date(newMax).toISOString()}`);
  console.log(`   Entradas futuras restantes: ${stillFuture}`);
} catch (err) {
  console.error('❌ Error reparando fechas:', err);
  process.exitCode = 1;
} finally {
  await closeAll();
}
