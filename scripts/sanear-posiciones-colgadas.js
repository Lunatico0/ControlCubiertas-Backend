// M3 (auditoría 26/10, S7): posiciones de cubierta que no significan nada.
//
// Detecta tres casos:
//   1. Cubiertas en depósito (vehicle: null) que conservan una posición. Es lo que dejaba
//      deshacer una asignación antes del fix de S7 ("E1-D" sin vehículo).
//   2. Cubiertas montadas cuya posición no existe en los ejes de su vehículo (o cuyo vehículo
//      ya no existe).
//   3. Dos o más cubiertas en el mismo vehículo y la misma posición.
// Con --apply corrige SOLO el caso 1 (position: null). Los casos 2 y 3 se listan para
// resolverlos a mano: elegir cuál cubierta queda en la posición es una decisión del taller.
//
// Uso:  cd backend && node scripts/sanear-posiciones-colgadas.js [dbName ...] [--apply]
//   - sin dbName: recorre TODOS los tenants del control plane (CONTROL_PLANE_URI).
//   - con dbName(s): solo esas DBs de tenant (DB-per-tenant).
//
// Corre en DRY-RUN por defecto: lista lo que haría sin tocar nada. Para escribir de verdad
// hay que pasar --apply. Es un script que ESCRIBE en bases reales: leerlo entero y confirmar
// contra qué tenant apunta antes de cada corrida.
import { config } from 'dotenv';
import { MongoClient } from 'mongodb';
import { pathToFileURL } from 'node:url';
import { generatePositions } from '../src/utils/axles.js';

/**
 * Función pura de detección (sin I/O, es lo que se testea).
 * @param {Array<{_id, code, vehicle, position}>} cubiertas
 * @param {Map<string, {_id, axles}>} vehiculosPorId  vehículos del tenant por id (string)
 * @returns {{ colgadas: Array, inexistentes: Array, duplicadas: Array }}
 */
export function detectarPosicionesColgadas(cubiertas, vehiculosPorId) {
  const colgadas = [];
  const inexistentes = [];
  const porSlot = new Map();

  for (const t of cubiertas) {
    if (!t.position) continue;
    const resumen = { tire: String(t._id), code: t.code, position: t.position };

    if (!t.vehicle) {
      colgadas.push(resumen);
      continue;
    }

    const vehicleId = String(t.vehicle);
    const vehiculo = vehiculosPorId.get(vehicleId);
    if (!vehiculo) {
      inexistentes.push({ ...resumen, vehicle: vehicleId, motivo: 'el vehículo no existe' });
      continue;
    }
    const existe = generatePositions(vehiculo.axles || []).some((p) => p.code === t.position);
    if (!existe) {
      inexistentes.push({ ...resumen, vehicle: vehicleId, motivo: 'la posición no existe en los ejes del vehículo' });
    }

    const slot = `${vehicleId}|${t.position}`;
    if (!porSlot.has(slot)) porSlot.set(slot, []);
    porSlot.get(slot).push(resumen);
  }

  const duplicadas = [];
  for (const [slot, ocupantes] of porSlot) {
    if (ocupantes.length > 1) {
      const [vehicle, position] = slot.split('|');
      duplicadas.push({ vehicle, position, cubiertas: ocupantes.map((o) => ({ tire: o.tire, code: o.code })) });
    }
  }

  return { colgadas, inexistentes, duplicadas };
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
  const APPLY = args.includes('--apply');
  const explicitos = args.filter((a) => !a.startsWith('--'));

  const bases = explicitos.length ? explicitos : await dbNamesDesdeControlPlane();
  console.log(`${APPLY ? 'APLICANDO' : 'DRY-RUN (usá --apply para escribir)'} sobre ${bases.length} base(s): ${bases.join(', ')}`);

  const client = new MongoClient(process.env.MONGO_URI);
  await client.connect();

  const total = { colgadas: 0, inexistentes: 0, duplicadas: 0 };

  for (const dbName of bases) {
    const db = client.db(dbName);
    const cubiertas = await db.collection('tires')
      .find({ position: { $nin: [null, ''] } }, { projection: { code: 1, vehicle: 1, position: 1 } })
      .toArray();
    const vehiculos = await db.collection('vehicles').find({}, { projection: { axles: 1 } }).toArray();
    const vehiculosPorId = new Map(vehiculos.map((v) => [String(v._id), v]));

    const { colgadas, inexistentes, duplicadas } = detectarPosicionesColgadas(cubiertas, vehiculosPorId);

    console.log(`  ${dbName}: ${colgadas.length} en depósito con posición · ${inexistentes.length} con posición inexistente · ${duplicadas.length} posición(es) duplicada(s)`);
    for (const c of colgadas) console.log(`    [depósito] cubierta ${c.code} (${c.tire}) con posición ${c.position}`);
    for (const c of inexistentes) console.log(`    [revisar] cubierta ${c.code} (${c.tire}) en ${c.position} del vehículo ${c.vehicle}: ${c.motivo}`);
    for (const d of duplicadas) {
      console.log(`    [revisar] vehículo ${d.vehicle} posición ${d.position}: ${d.cubiertas.map((c) => c.code).join(', ')}`);
    }

    if (APPLY && colgadas.length) {
      // El filtro repite `vehicle: null`: si entre la lectura y la escritura alguien la montó,
      // no se le borra la posición recién asignada.
      const res = await db.collection('tires').updateMany(
        { _id: { $in: cubiertas.filter((t) => !t.vehicle).map((t) => t._id) }, vehicle: null },
        { $set: { position: null } },
      );
      console.log(`    ${res.modifiedCount} posición(es) limpiada(s)`);
    }

    total.colgadas += colgadas.length;
    total.inexistentes += inexistentes.length;
    total.duplicadas += duplicadas.length;
  }

  console.log(`Total: ${total.colgadas} en depósito con posición${APPLY ? ' (limpiadas)' : ''} · ${total.inexistentes} con posición inexistente · ${total.duplicadas} duplicada(s) (a mano)`);
  await client.close();
}

const esPrincipal = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (esPrincipal) await main();
