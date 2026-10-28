// M8 (auditoría 26/10, hallazgo A3): lista los tenant-admin que siguen con la contraseña con
// la que se los aprovisionó.
//
// Antes del fix, provisionTenant creaba el admin SIN mustChangePassword: la temporal que
// alguien le entregó quedaba como definitiva. tokenVersion sube en cada cambio de contraseña
// (voluntario o de primer ingreso) y en cada reset del admin, así que tokenVersion 0 (o sin
// el campo, documentos anteriores a él) = nunca la cambió ni se la resetearon.
//
// Uso:  cd backend && node scripts/detectar-admins-sin-cambio.js
//   - Lee el control plane (CONTROL_PLANE_URI). Necesita SOLO esa variable.
//
// SOLO LECTURA, siempre: no tiene --apply. Forzar el cambio (mustChangePassword: true) en los
// listados lo decide Patricio, a mano y uno por uno. Igual apunta a la base REAL de
// producción si así está el .env: leerlo entero y confirmar contra qué control plane corre.
//
// Qué NO lista:
//   - la plantilla de la demo (isDemoTemplate) ni sus clones (demoOf): su clave es pública a
//     propósito y no puede quedar obligada;
//   - quien ya está obligado (mustChangePassword: true): la API ya lo frena hasta el cambio;
//   - usuarios inactivos: no pueden iniciar sesión.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const id = (v) => (v == null ? '' : String(v));

// Función pura de detección: recibe los documentos crudos (users y tenants del control plane)
// y devuelve las filas a reportar, sin tocar ninguna base.
export function detectarAdminsSinCambio(users, tenants) {
  const porId = new Map(tenants.map((t) => [id(t._id), t]));
  const esDemo = (t) => Boolean(t && (t.isDemoTemplate || t.demoOf));

  return users
    .filter((u) => u.role === 'tenant-admin')
    .filter((u) => (u.tokenVersion ?? 0) === 0)
    .filter((u) => u.mustChangePassword !== true)
    .filter((u) => (u.status ?? 'active') === 'active')
    .filter((u) => !esDemo(porId.get(id(u.tenantId))))
    .map((u) => {
      const t = porId.get(id(u.tenantId)) ?? null;
      return {
        userId: id(u._id),
        email: u.email,
        name: u.name ?? null,
        creado: u.createdAt ?? null,
        tenant: t ? t.name : null,
        dbName: t ? t.dbName : null,
        tenantStatus: t ? t.status ?? 'active' : null,
      };
    });
}

async function main() {
  const { config } = await import('dotenv');
  const { MongoClient } = await import('mongodb');
  config();

  if (process.argv.includes('--apply')) {
    console.log('Este script es de solo lectura: --apply no hace nada. Forzar el cambio se decide y se hace a mano.');
  }
  const uri = process.env.CONTROL_PLANE_URI;
  if (!uri) {
    console.error('Falta CONTROL_PLANE_URI en el .env');
    process.exit(1);
  }

  const cp = new MongoClient(uri);
  await cp.connect();
  try {
    const db = cp.db();
    const tenants = await db.collection('tenants')
      .find({}, { projection: { name: 1, dbName: 1, status: 1, isDemoTemplate: 1, demoOf: 1 } })
      .toArray();
    // Nunca se lee passwordHash: no hace falta y no tiene por qué salir de la base.
    const users = await db.collection('users')
      .find({ role: 'tenant-admin' }, { projection: { email: 1, name: 1, role: 1, status: 1, tenantId: 1, tokenVersion: 1, mustChangePassword: 1, createdAt: 1 } })
      .toArray();

    const filas = detectarAdminsSinCambio(users, tenants);
    console.log(`SOLO LECTURA. ${users.length} tenant-admin revisado(s), ${filas.length} sin cambio de contraseña desde el alta:`);
    for (const f of filas) {
      const creado = f.creado ? new Date(f.creado).toISOString().slice(0, 10) : 'sin fecha';
      const tenant = f.tenant ? `${f.tenant} (${f.dbName}, ${f.tenantStatus})` : 'TENANT INEXISTENTE';
      console.log(`  ${f.email}${f.name ? ` [${f.name}]` : ''} · ${tenant} · alta ${creado} · userId ${f.userId}`);
    }
  } finally {
    await cp.close();
  }
}

// Solo corre al invocarlo como script: importarlo (el test de la función pura) no conecta a nada.
const esScript = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (esScript) {
  main().catch((e) => {
    console.error('Error:', e.message);
    process.exitCode = 1;
  });
}
