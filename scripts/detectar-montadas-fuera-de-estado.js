// M4 (auditoría 26/10, S4): cubiertas MONTADAS en un estado que no admite estar montada.
//
// Antes del fix de S4 una cubierta montada podía pasar a "A recapar" o a "Descartada" sin
// bajarla del vehículo. Este script lista las que quedaron así. La decisión es por ROL del
// tenant (recap / discard), nunca por nombre: cada tenant llama a sus estados como quiere.
//
// SOLO LISTA. No tiene --apply: resolver cada caso (desmontar con el km real, o corregir el
// estado) es una decisión del taller que no se puede automatizar.
//
// Uso:  cd backend && node scripts/detectar-montadas-fuera-de-estado.js [dbName ...]
//   - sin dbName: recorre TODOS los tenants del control plane.
//   - con dbName(s): solo esas DBs de tenant.
// Necesita CONTROL_PLANE_URI siempre (los estados de cada tenant viven ahí) y MONGO_URI.
import { config } from 'dotenv';
import { MongoClient } from 'mongodb';
import { pathToFileURL } from 'node:url';
import { normalizeStatuses, roleOf } from '../src/utils/statuses.js';

const ROLES_FUERA_DE_VEHICULO = new Set(['recap', 'discard']);

/**
 * Función pura de detección (sin I/O, es lo que se testea).
 * @param {Array<{_id, code, vehicle, status}>} cubiertas
 * @param {Array<{name, role}>} statuses  estados del tenant ya normalizados
 */
export function detectarMontadasFueraDeEstado(cubiertas, statuses) {
  const encontradas = [];
  for (const t of cubiertas) {
    if (!t.vehicle) continue;
    const rol = roleOf(statuses, t.status);
    if (ROLES_FUERA_DE_VEHICULO.has(rol)) {
      encontradas.push({ tire: String(t._id), code: t.code, vehicle: String(t.vehicle), status: t.status, rol });
    }
  }
  return encontradas;
}

async function tenantsDesdeControlPlane(explicitos) {
  const uri = process.env.CONTROL_PLANE_URI;
  if (!uri) throw new Error('Falta CONTROL_PLANE_URI: los estados de cada tenant viven en el control plane.');
  const cp = new MongoClient(uri);
  await cp.connect();
  const filtro = explicitos.length ? { dbName: { $in: explicitos } } : {};
  const tenants = await cp.db().collection('tenants')
    .find(filtro, { projection: { dbName: 1, stockStatuses: 1 } })
    .toArray();
  await cp.close();
  const faltantes = explicitos.filter((n) => !tenants.some((t) => t.dbName === n));
  if (faltantes.length) throw new Error(`No hay tenant en el control plane para: ${faltantes.join(', ')}`);
  return tenants.filter((t) => t.dbName);
}

async function main() {
  config();
  const args = process.argv.slice(2);
  if (args.includes('--apply')) {
    console.error('Este script solo lista: no tiene --apply. Cada caso se resuelve a mano desde la app.');
    process.exit(1);
  }
  const explicitos = args.filter((a) => !a.startsWith('--'));

  const tenants = await tenantsDesdeControlPlane(explicitos);
  console.log(`SOLO LECTURA sobre ${tenants.length} base(s): ${tenants.map((t) => t.dbName).join(', ')}`);

  const client = new MongoClient(process.env.MONGO_URI);
  await client.connect();

  let total = 0;
  for (const tenant of tenants) {
    const statuses = normalizeStatuses(tenant.stockStatuses);
    const cubiertas = await client.db(tenant.dbName).collection('tires')
      .find({ vehicle: { $ne: null } }, { projection: { code: 1, vehicle: 1, status: 1 } })
      .toArray();

    const encontradas = detectarMontadasFueraDeEstado(cubiertas, statuses);
    console.log(`  ${tenant.dbName}: ${encontradas.length} cubierta(s) montada(s) fuera de estado`);
    for (const e of encontradas) {
      console.log(`    cubierta ${e.code} (${e.tire}) en el vehículo ${e.vehicle}: "${e.status}" (rol ${e.rol})`);
    }
    total += encontradas.length;
  }

  console.log(`Total: ${total} cubierta(s) a resolver a mano`);
  await client.close();
}

const esPrincipal = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (esPrincipal) await main();
