// M1 (auditoría 2026-10-26, hallazgo S1): detecta los vehículos que quedaron SIN tipo porque
// editar sus datos (PUT /api/vehicles/details/:id) se los borraba. Para cada uno propone un
// tipo comparando sus ejes contra el catálogo: presets del front + tipos custom del tenant.
//
// Uso:  cd backend && node scripts/detectar-vehiculos-sin-tipo.js [dbName ...] [--apply]
//   - sin dbName: recorre TODOS los tenants del control plane (CONTROL_PLANE_URI).
//   - con dbName(s): sólo esas DBs de tenant (DB-per-tenant).
//
// Corre en DRY-RUN por defecto: lista lo que haría sin tocar nada. Con --apply setea `type`
// SOLO en las coincidencias únicas. Los ambiguos (varios tipos con el mismo layout), los sin
// ejes y los que no coinciden con ningún tipo se listan para resolver a mano desde la UI
// (Configurar ejes). Es un script que ESCRIBE en bases reales: leerlo entero y confirmar
// contra qué tenant apunta antes de cada corrida.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { MongoClient } from 'mongodb';

// Copia mínima de AXLE_PRESETS de frontend/src/components/Operativa/vehicleTypes.js (label y
// layout de ejes, delantero a trasero). Se copia porque el backend no puede importar código
// del front (repo y CI separados). Si cambia el catálogo del front, actualizar esta tabla.
export const PRESETS_TIPO = [
  { label: 'Moto', axles: ['moto', 'moto'] },
  { label: 'Auto / Utilitario', axles: ['simple', 'simple'] },
  { label: 'Camión 4×2', axles: ['simple', 'dual'] },
  { label: 'Camión 6×4', axles: ['simple', 'dual', 'dual'] },
  { label: 'Semirremolque 2 ejes', axles: ['dual', 'dual'] },
  { label: 'Bus larga dist. 6×2', axles: ['simple', 'dual', 'simple'] },
  { label: 'Semirremolque 3 ejes', axles: ['dual', 'dual', 'dual'] },
  { label: 'Bitrén 4 ejes', axles: ['simple', 'dual', 'dual', 'dual'] },
  { label: 'Acoplado 4 ejes', axles: ['dual', 'dual', 'dual', 'dual'] },
];

// Sin tipo = el campo no existe, es null, no es string o es vacío / solo espacios.
export const necesitaTipo = (vehicle) => typeof vehicle?.type !== 'string' || vehicle.type.trim() === '';

// Los ejes del vehículo se guardan como [{ type }]; los de VehicleType como strings.
const layoutDe = (axles) => (axles || []).map((a) => (typeof a === 'string' ? a : a?.type));
const mismoLayout = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// Propone un tipo para UN vehículo. Catálogo = presets primero y después los custom del
// tenant, en ese orden. Los candidatos se deduplican por nombre: un custom que se llama igual
// que un preset y tiene su mismo layout es el mismo tipo, no una ambigüedad.
export function proponerTipo(vehicle, customTypes = []) {
  const layout = layoutDe(vehicle?.axles);
  if (!layout.length) return { estado: 'sin-ejes' };

  const catalogo = [
    ...PRESETS_TIPO,
    ...customTypes.map((c) => ({ label: (c.name || '').trim(), axles: layoutDe(c.axles) })),
  ];
  const candidatos = [...new Set(
    catalogo.filter((t) => t.label && mismoLayout(t.axles, layout)).map((t) => t.label),
  )];

  if (candidatos.length === 1) return { estado: 'unico', tipo: candidatos[0] };
  if (candidatos.length > 1) return { estado: 'ambiguo', candidatos };
  return { estado: 'sin-coincidencia', layout };
}

// Reparte los vehículos SIN tipo de un tenant según lo que se puede proponer.
export function clasificarVehiculos(vehicles, customTypes = []) {
  const r = { unicos: [], ambiguos: [], sinEjes: [], sinCoincidencia: [] };
  for (const v of vehicles) {
    if (!necesitaTipo(v)) continue;
    const base = { _id: v._id, mobile: v.mobile };
    const p = proponerTipo(v, customTypes);
    if (p.estado === 'unico') r.unicos.push({ ...base, tipo: p.tipo });
    else if (p.estado === 'ambiguo') r.ambiguos.push({ ...base, candidatos: p.candidatos });
    else if (p.estado === 'sin-ejes') r.sinEjes.push(base);
    else r.sinCoincidencia.push({ ...base, layout: p.layout });
  }
  return r;
}

// Mismo criterio que necesitaTipo, como filtro de Mongo. Se usa en el update para no pisar
// un tipo que alguien haya cargado desde la UI entre la lectura y la escritura.
const FILTRO_SIN_TIPO = {
  $or: [{ type: { $exists: false } }, { type: null }, { type: { $not: { $type: 'string' } } }, { type: /^\s*$/ }],
};

async function dbNamesDesdeControlPlane() {
  const uri = process.env.CONTROL_PLANE_URI;
  if (!uri) throw new Error('Falta CONTROL_PLANE_URI (o pasá los dbName como argumentos).');
  const cp = new MongoClient(uri);
  await cp.connect();
  const tenants = await cp.db().collection('tenants').find({}, { projection: { dbName: 1 } }).toArray();
  await cp.close();
  return tenants.map((t) => t.dbName).filter(Boolean);
}

const etiqueta = (v) => `móvil ${v.mobile ?? '?'} (${v._id})`;

async function main() {
  config();
  const args = process.argv.slice(2);
  const APPLY = args.includes('--apply');
  const explicitos = args.filter((a) => !a.startsWith('--'));

  if (!process.env.MONGO_URI) throw new Error('Falta MONGO_URI en el entorno.');

  const bases = explicitos.length ? explicitos : await dbNamesDesdeControlPlane();
  console.log(`${APPLY ? 'APLICANDO' : 'DRY-RUN (usá --apply para escribir)'} sobre ${bases.length} base(s): ${bases.join(', ')}`);

  const client = new MongoClient(process.env.MONGO_URI);
  await client.connect();

  const total = { unicos: 0, aplicados: 0, ambiguos: 0, sinEjes: 0, sinCoincidencia: 0 };

  try {
    for (const dbName of bases) {
      const db = client.db(dbName);
      const vehicles = await db.collection('vehicles')
        .find({}, { projection: { mobile: 1, type: 1, axles: 1 } }).toArray();
      const customTypes = await db.collection('vehicletypes').find({}).toArray();
      const r = clasificarVehiculos(vehicles, customTypes);

      const sinTipo = r.unicos.length + r.ambiguos.length + r.sinEjes.length + r.sinCoincidencia.length;
      console.log(`\n=== ${dbName}: ${sinTipo} vehículo(s) sin tipo de ${vehicles.length} ===`);

      for (const v of r.unicos) {
        let nota = '';
        if (APPLY) {
          const res = await db.collection('vehicles').updateOne({ _id: v._id, ...FILTRO_SIN_TIPO }, { $set: { type: v.tipo } });
          if (res.modifiedCount) total.aplicados += 1;
          else nota = ' (no se tocó: ya tenía tipo al escribir)';
        }
        console.log(`  [único]            ${etiqueta(v)} -> "${v.tipo}"${nota}`);
      }
      for (const v of r.ambiguos) {
        console.log(`  [ambiguo, a mano]  ${etiqueta(v)}: ${v.candidatos.map((c) => `"${c}"`).join(' / ')}`);
      }
      for (const v of r.sinEjes) {
        console.log(`  [sin ejes, a mano] ${etiqueta(v)}: configurar los ejes desde la UI`);
      }
      for (const v of r.sinCoincidencia) {
        console.log(`  [sin match, a mano] ${etiqueta(v)}: layout [${v.layout.join(', ')}] no coincide con ningún tipo`);
      }

      total.unicos += r.unicos.length;
      total.ambiguos += r.ambiguos.length;
      total.sinEjes += r.sinEjes.length;
      total.sinCoincidencia += r.sinCoincidencia.length;
    }
  } finally {
    await client.close();
  }

  console.log('\n----------------------------------------');
  console.log(`Únicos: ${total.unicos}${APPLY ? ` (aplicados: ${total.aplicados})` : ' (se aplicarían con --apply)'}`);
  console.log(`A mano: ${total.ambiguos} ambiguo(s) · ${total.sinEjes} sin ejes · ${total.sinCoincidencia} sin coincidencia`);
}

// Sólo corre cuando se ejecuta como script. Importarlo (los tests de las funciones puras) no
// debe conectarse a nada ni leer el .env.
const esPrincipal = (() => {
  if (!process.argv[1]) return false;
  const norm = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  return norm(fileURLToPath(import.meta.url)) === norm(process.argv[1]);
})();

if (esPrincipal) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
