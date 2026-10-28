// M2 (auditoría 26/10, S3): correcciones de datos de alta "fantasma".
//
// Antes del fix de S3, corregir el código de una cubierta a uno que ya usaba otra escribía la
// entrada "Corrección-Alta" y reservaba su número de comprobante ANTES de guardar la
// cubierta; el guardado rebotaba por el índice único y quedaba una corrección que nunca
// ocurrió, con un número emitido. Este script lista esas entradas y su número.
//
// Criterio: Corrección-Alta sin `corrects`, con `code` entre los campos editados, cuya
// cubierta tiene su última actualización ANTERIOR a la entrada por más de TOLERANCIA_MS.
// La tolerancia existe porque, desde el fix, la cubierta se guarda primero y la entrada se
// escribe milisegundos después: sin ella, toda corrección legítima nueva saldría como fantasma.
// Límite conocido: si la cubierta se volvió a guardar después (otro movimiento), la fantasma
// ya no se distingue y no se lista.
//
// --apply NO está implementado: qué se hace con estas entradas depende de la decisión de
// producto Q7 (marcarlas anuladas, ocultarlas o dejarlas). Hasta entonces, solo lista.
//
// Uso:  cd backend && node scripts/detectar-correcciones-fantasma.js [dbName ...]
//   - sin dbName: recorre TODOS los tenants del control plane (CONTROL_PLANE_URI).
//   - con dbName(s): solo esas DBs de tenant.
import { config } from 'dotenv';
import { MongoClient } from 'mongodb';
import { pathToFileURL } from 'node:url';

export const TOLERANCIA_MS = 5000;

/**
 * Función pura de detección (sin I/O, es lo que se testea).
 * @param {Array} entradas  entradas de History
 * @param {Map<string, {_id, code, updatedAt}>} cubiertasPorId
 * @returns {{ fantasmas: Array, sinCubierta: Array }}
 */
export function detectarCorreccionesFantasma(entradas, cubiertasPorId) {
  const fantasmas = [];
  const sinCubierta = [];

  for (const e of entradas) {
    if (e.type !== 'Corrección-Alta' || e.corrects) continue;
    if (!(e.editedFields || []).includes('code')) continue;

    const tireId = String(e.tire);
    const tire = cubiertasPorId.get(tireId);
    if (!tire) {
      sinCubierta.push({ entrada: String(e._id), tire: tireId, receiptNumber: e.receiptNumber });
      continue;
    }

    const creada = new Date(e.createdAt).getTime();
    const guardada = new Date(tire.updatedAt).getTime();
    if (creada - guardada > TOLERANCIA_MS) {
      fantasmas.push({
        entrada: String(e._id),
        tire: tireId,
        code: tire.code,
        receiptNumber: e.receiptNumber,
        createdAt: e.createdAt,
        editedFields: e.editedFields,
      });
    }
  }

  return { fantasmas, sinCubierta };
}

async function dbNamesDesdeControlPlane() {
  const uri = process.env.CONTROL_PLANE_URI;
  if (!uri) throw new Error('Falta CONTROL_PLANE_URI (o pasá los dbName como argumentos).');
  const cp = new MongoClient(uri);
  await cp.connect();
  const tenants = await cp.db().collection('tenants').find({}, { projection: { dbName: 1 } }).toArray();
  await cp.close();
  return tenants.map((t) => t.dbName).filter(Boolean);
}

async function main() {
  config();
  const args = process.argv.slice(2);
  if (args.includes('--apply')) {
    console.error('--apply no está implementado: qué hacer con las correcciones fantasma depende de la decisión Q7. Por ahora el script solo lista.');
    process.exit(1);
  }
  const explicitos = args.filter((a) => !a.startsWith('--'));

  const bases = explicitos.length ? explicitos : await dbNamesDesdeControlPlane();
  console.log(`SOLO LECTURA sobre ${bases.length} base(s): ${bases.join(', ')}`);

  const client = new MongoClient(process.env.MONGO_URI);
  await client.connect();

  let total = 0;
  for (const dbName of bases) {
    const db = client.db(dbName);
    const entradas = await db.collection('histories')
      .find({ type: 'Corrección-Alta', editedFields: 'code', corrects: { $exists: false } })
      .project({ tire: 1, type: 1, editedFields: 1, corrects: 1, receiptNumber: 1, createdAt: 1 })
      .toArray();
    const ids = [...new Set(entradas.map((e) => e.tire))];
    const cubiertas = await db.collection('tires')
      .find({ _id: { $in: ids } }, { projection: { code: 1, updatedAt: 1 } })
      .toArray();
    const cubiertasPorId = new Map(cubiertas.map((t) => [String(t._id), t]));

    const { fantasmas, sinCubierta } = detectarCorreccionesFantasma(entradas, cubiertasPorId);
    console.log(`  ${dbName}: ${fantasmas.length} corrección(es) fantasma · ${sinCubierta.length} sin cubierta (no se puede decidir)`);
    for (const f of fantasmas) {
      console.log(`    comprobante ${f.receiptNumber}: cubierta ${f.code} (${f.tire}), entrada ${f.entrada} del ${new Date(f.createdAt).toISOString()}`);
    }
    for (const s of sinCubierta) {
      console.log(`    [revisar] comprobante ${s.receiptNumber}: entrada ${s.entrada} de una cubierta que ya no existe (${s.tire})`);
    }
    total += fantasmas.length;
  }

  console.log(`Total: ${total} corrección(es) fantasma (números de comprobante emitidos sin movimiento real)`);
  await client.close();
}

const esPrincipal = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (esPrincipal) await main();
