// M5 (auditoría 26/10, S6/S7 y N1): tipos de historial reetiquetados.
//
// Antes del fix, corregir o deshacer una entrada reetiquetaba la ORIGINAL a "Corrección-*":
// el historial perdía qué había sido el movimiento. Y un deshacer RECHAZADO (N1) la marcaba
// igual ("Deshacer entrada", motivo "Deshecho en la orden ...") sin que exista el deshacer.
//
// Detecta, entre las entradas Corrección-* que NO corrigen a ninguna otra (las que sí son
// correcciones genuinas y se dejan como están):
//   - reetiquetadas: alguna otra entrada las `corrects`. Propuesta: volver al tipo base y
//     completar `correctedAt` con la fecha de la entrada que las corrige.
//   - deshaceresFallidos: marcadas "Deshacer entrada" y NADIE las corrige. Propuesta: tipo
//     base, sin flag, sin motivo, sin campos editados y sin fecha de corrección.
//   - ambiguas: no se puede saber el tipo original o el dato original se perdió. A mano.
// "Corrección-Alta" es el caso delicado: también la escribe la corrección de datos de alta
// (legítima). Se toma como un Alta reetiquetada solo si la cubierta no tiene otra entrada
// "Alta" y esta es su primera entrada.
//
// --apply NO está implementado: depende de la decisión de producto Q7. Hasta entonces el
// script solo lista y muestra la propuesta de cada entrada.
//
// Uso:  cd backend && node scripts/restaurar-tipos-historial.js [dbName ...]
//   - sin dbName: recorre TODOS los tenants del control plane (CONTROL_PLANE_URI).
//   - con dbName(s): solo esas DBs de tenant.
import { config } from 'dotenv';
import { MongoClient } from 'mongodb';
import { pathToFileURL } from 'node:url';

const PREFIJO = 'Corrección-';
const TIPOS_BASE = new Set(['Alta', 'Asignación', 'Desasignación', 'Estado']);
const MARCA_DESHACER = 'Deshacer entrada';

const esMarcaDeshacer = (e) => (e.editedFields || []).length === 1 && e.editedFields[0] === MARCA_DESHACER;

/**
 * Función pura de detección (sin I/O, es lo que se testea).
 * @param {Array} entradas  TODAS las entradas de History del tenant (o de un conjunto de
 *   cubiertas completo: el criterio mira las demás entradas de la misma cubierta)
 * @returns {{ reetiquetadas: Array, deshaceresFallidos: Array, ambiguas: Array }}
 */
export function detectarTiposARestaurar(entradas) {
  const correctorDe = new Map();
  const porCubierta = new Map();
  for (const e of entradas) {
    if (e.corrects && !correctorDe.has(String(e.corrects))) correctorDe.set(String(e.corrects), e);
    const tire = String(e.tire);
    if (!porCubierta.has(tire)) porCubierta.set(tire, []);
    porCubierta.get(tire).push(e);
  }

  const reetiquetadas = [];
  const deshaceresFallidos = [];
  const ambiguas = [];

  for (const e of entradas) {
    if (!String(e.type || '').startsWith(PREFIJO) || e.corrects) continue;
    const tipoBase = e.type.slice(PREFIJO.length);
    if (!TIPOS_BASE.has(tipoBase)) continue;

    const id = String(e._id);
    const tire = String(e.tire);
    const corrector = correctorDe.get(id);
    const fallido = !corrector && esMarcaDeshacer(e);
    if (!corrector && !fallido) continue; // corrección de datos de alta legítima

    if (tipoBase === 'Alta') {
      const propias = porCubierta.get(tire) || [];
      const tieneOtraAlta = propias.some((o) => o.type === 'Alta' && String(o._id) !== id);
      if (tieneOtraAlta) {
        // Es una corrección de datos de alta genuina. Corregida por otra: está bien como está.
        // Con un deshacer fallido: el tipo está bien, pero su motivo original se perdió.
        if (fallido) {
          ambiguas.push({ entrada: id, tire, tipoActual: e.type, motivo: 'Corrección de datos de alta con un deshacer fallido: el motivo original se perdió' });
        }
        continue;
      }
      const primera = propias.reduce((min, o) => (new Date(o.date) < new Date(min.date) ? o : min), e);
      if (String(primera._id) !== id) {
        ambiguas.push({ entrada: id, tire, tipoActual: e.type, motivo: 'La cubierta no tiene Alta pero esta entrada no es la primera: no se sabe si era el Alta' });
        continue;
      }
    }

    if (corrector) {
      const $set = { type: tipoBase };
      if (!e.correctedAt) $set.correctedAt = corrector.createdAt ?? corrector.date;
      reetiquetadas.push({ entrada: id, tire, tipoActual: e.type, tipoBase, propuesta: { $set } });
    } else {
      deshaceresFallidos.push({
        entrada: id,
        tire,
        tipoActual: e.type,
        tipoBase,
        reason: e.reason,
        propuesta: { $set: { type: tipoBase, flag: false, editedFields: [] }, $unset: { reason: '', correctedAt: '' } },
      });
    }
  }

  return { reetiquetadas, deshaceresFallidos, ambiguas };
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
    console.error('--apply no está implementado: restaurar los tipos depende de la decisión Q7. Por ahora el script solo lista la propuesta.');
    process.exit(1);
  }
  const explicitos = args.filter((a) => !a.startsWith('--'));

  const bases = explicitos.length ? explicitos : await dbNamesDesdeControlPlane();
  console.log(`SOLO LECTURA sobre ${bases.length} base(s): ${bases.join(', ')}`);

  const client = new MongoClient(process.env.MONGO_URI);
  await client.connect();

  const total = { reetiquetadas: 0, deshaceresFallidos: 0, ambiguas: 0 };
  for (const dbName of bases) {
    const entradas = await client.db(dbName).collection('histories')
      .find({}, { projection: { tire: 1, type: 1, corrects: 1, editedFields: 1, flag: 1, reason: 1, date: 1, createdAt: 1, correctedAt: 1, receiptNumber: 1 } })
      .toArray();

    const r = detectarTiposARestaurar(entradas);
    console.log(`  ${dbName}: ${r.reetiquetadas.length} reetiquetada(s) · ${r.deshaceresFallidos.length} deshacer(es) fallido(s) · ${r.ambiguas.length} ambigua(s)`);
    for (const x of r.reetiquetadas) console.log(`    [reetiquetada] entrada ${x.entrada} (cubierta ${x.tire}): ${x.tipoActual} -> ${x.tipoBase}`);
    for (const x of r.deshaceresFallidos) console.log(`    [deshacer fallido] entrada ${x.entrada} (cubierta ${x.tire}): ${x.tipoActual} -> ${x.tipoBase}, motivo "${x.reason ?? ''}" se quitaría`);
    for (const x of r.ambiguas) console.log(`    [a mano] entrada ${x.entrada} (cubierta ${x.tire}): ${x.motivo}`);

    total.reetiquetadas += r.reetiquetadas.length;
    total.deshaceresFallidos += r.deshaceresFallidos.length;
    total.ambiguas += r.ambiguas.length;
  }

  console.log(`Total: ${total.reetiquetadas} reetiquetada(s) · ${total.deshaceresFallidos} deshacer(es) fallido(s) · ${total.ambiguas} a mano`);
  await client.close();
}

const esPrincipal = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (esPrincipal) await main();
