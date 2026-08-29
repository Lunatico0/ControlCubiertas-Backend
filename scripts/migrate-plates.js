// Migración t138: lleva TODAS las patentes guardadas a la forma canónica (MAYÚSCULAS,
// alfanumérica, sin separadores). Hasta ahora convivían "ABC-301" (dato viejo) y "ABC301"
// (dato nuevo, ya normalizado por el controlador): el chequeo de duplicados por igualdad no
// cruzaba las dos formas y se podían crear DOS vehículos con la misma chapa.
//
// El controlador ya se blindó con plateMatcher (ver utils/plate.js), que ignora separadores,
// así que el duplicado ya no entra ni antes de correr esto. Este script es el que deja los
// datos en un solo formato para que la búsqueda por patente devuelva siempre todo.
//
// Reporta además qué patentes YA GUARDADAS quedan FUERA del formato configurado por su
// tenant. Esos vehículos se leen y se operan igual; lo que falla es EDITARLOS (400), hasta
// que se corrija la patente o se destilden los formatos en el panel de Empresa.
//
// Uso:  cd backend && node scripts/migrate-plates.js [dbName ...] [--apply]
//   - sin argumentos: recorre TODOS los tenants del control plane (CONTROL_PLANE_URI).
//   - con dbName(s): migra sólo esas DBs de tenant (DB-per-tenant).
//
// DRY-RUN por defecto: lista lo que haría sin tocar nada; --apply escribe.
//
// COLISIONES: si dos vehículos distintos normalizan a la MISMA patente, el script NO elige
// por vos. Las reporta y NO toca ninguno de los dos, ni siquiera con --apply: decidir cuál
// sobrevive es una decisión de negocio, y el índice único haría fallar el update igual.
import { config } from 'dotenv';
import { MongoClient } from 'mongodb';
import { isValidPlate, PLATE_FORMATS_AR } from '../src/utils/plate.js';

config();

const normalizePlate = (value) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// El chequeo de formato usa EL MISMO módulo que el backend en runtime (src/utils/plate.js),
// no una copia. Una segunda implementación de las máscaras acá se desincronizaría del
// validador real y este script terminaría dando un veredicto que no es el que la app aplica.

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const explicitos = args.filter((a) => !a.startsWith('--'));

// Se traen también los `plateFormats` de cada tenant: el chequeo de formato tiene que usar
// las máscaras QUE ESE TENANT tiene configuradas, no un default global.
async function tenantsDesdeControlPlane() {
  const uri = process.env.CONTROL_PLANE_URI;
  if (!uri) throw new Error('Falta CONTROL_PLANE_URI (o pasá los dbName como argumentos).');
  const cp = new MongoClient(uri);
  await cp.connect();
  const tenants = await cp.db().collection('tenants')
    .find({}, { projection: { dbName: 1, name: 1, plateFormats: 1 } }).toArray();
  await cp.close();
  return tenants.filter((t) => t.dbName);
}

const tenants = explicitos.length
  ? explicitos.map((dbName) => ({ dbName, plateFormats: undefined }))
  : await tenantsDesdeControlPlane();
const bases = tenants.map((t) => t.dbName);
console.log(`${APPLY ? 'APLICANDO' : 'DRY-RUN (usá --apply para escribir)'} sobre ${bases.length} base(s): ${bases.join(', ')}`);

const client = new MongoClient(process.env.MONGO_URI);
await client.connect();

let totalCambios = 0;
let totalColisiones = 0;

let totalFueraDeFormato = 0;

for (const { dbName, plateFormats } of tenants) {
  const db = client.db(dbName);
  // `undefined` = el tenant nunca tuvo el campo escrito → aplica el default argentino, igual
  // que en runtime. Un array VACÍO guardado es una decisión explícita: no validar.
  const formatos = plateFormats === undefined ? PLATE_FORMATS_AR : plateFormats;
  const vehicles = await db.collection('vehicles')
    .find({}, { projection: { licensePlate: 1, mobile: 1 } })
    .toArray();

  // Índice canónica → vehículos que caen en ella. Más de uno = colisión.
  const porCanonica = new Map();
  for (const v of vehicles) {
    const canonica = normalizePlate(v.licensePlate);
    if (!canonica) continue;
    if (!porCanonica.has(canonica)) porCanonica.set(canonica, []);
    porCanonica.get(canonica).push(v);
  }

  const colisiones = [...porCanonica.entries()].filter(([, vs]) => vs.length > 1);
  const enColision = new Set(colisiones.flatMap(([, vs]) => vs.map((v) => String(v._id))));

  const aCambiar = vehicles.filter(
    (v) => v.licensePlate && normalizePlate(v.licensePlate) !== v.licensePlate && !enColision.has(String(v._id)),
  );

  // Lo que de verdad importa antes de un deploy: qué patentes YA GUARDADAS no entran en el
  // formato configurado de SU tenant. Esos vehículos se leen y se operan igual; lo que falla
  // es EDITARLOS (400), hasta que se corrija la patente o se destilden los formatos.
  const fueraDeFormato = vehicles.filter((v) => v.licensePlate && !isValidPlate(v.licensePlate, formatos));
  totalFueraDeFormato += fueraDeFormato.length;

  console.log(`\n[${dbName}] ${vehicles.length} vehículo(s) · ${aCambiar.length} a normalizar · ${colisiones.length} colisión(es) · ${fueraDeFormato.length} fuera de formato`);

  for (const v of fueraDeFormato) {
    console.log(`  ✖ FUERA DE FORMATO: ${v.mobile || '?'} (${v.licensePlate}) — editar este vehículo va a dar 400`);
  }

  for (const [canonica, vs] of colisiones) {
    totalColisiones += 1;
    const detalle = vs.map((v) => `${v.mobile || '?'} (${v.licensePlate})`).join(' vs ');
    console.log(`  ⚠ COLISIÓN en "${canonica}": ${detalle} — SIN TOCAR, resolvelo a mano`);
  }

  for (const v of aCambiar) {
    const canonica = normalizePlate(v.licensePlate);
    console.log(`  ${v.mobile || '?'}: "${v.licensePlate}" → "${canonica}"`);
    if (APPLY) {
      await db.collection('vehicles').updateOne({ _id: v._id }, { $set: { licensePlate: canonica } });
    }
    totalCambios += 1;
  }
}

await client.close();
console.log(`\n${APPLY ? 'Aplicados' : 'Pendientes'}: ${totalCambios} cambio(s). Colisiones sin resolver: ${totalColisiones}. Fuera de formato: ${totalFueraDeFormato}.`);
if (totalFueraDeFormato === 0) {
  console.log('✔ Ninguna patente guardada queda fuera del formato de su tenant: editar un vehículo no va a fallar por esto.');
}
if (totalColisiones) process.exitCode = 1;
