import crypto from 'node:crypto';
import { getControlModels } from '../db/controlPlane.js';
import { getTenantDb } from '../db/tenantConnections.js';

// Demo de producto: un tenant EFÍMERO por visitante.
//
// El recuadro del login promete un entorno de prueba que se restaura solo. Para que eso sea
// CIERTO —y no una leyenda decorativa— el visitante no puede escribir en la base del tenant
// demo compartido: lo que carga se queda ahí para siempre y ensucia la demo del próximo.
//
// El modelo es clonar. Al loguearse con las credenciales demo, el backend crea un tenant
// descartable a partir de la PLANTILLA (el tenant marcado `isDemoTemplate`) y firma el token
// contra ese. El prospecto usa el backend REAL: mismas validaciones, mismos correlativos,
// mismo historial derivado, sobre datos que son suyos y que se borran a las 48 hs.
//
// La alternativa que decía la leyenda original —simular las escrituras en el navegador— se
// descartó a propósito: obligaba a reimplementar en el browser el recálculo de estado de la
// cubierta, la reserva de correlativos y los guards por rol. La demo habría mostrado un
// comportamiento que el producto real no tiene, que es justo lo que una demo no puede hacer.

export const VENTANA_DEMO_MS = 48 * 60 * 60 * 1000;

// Config del tenant que se COPIA al clon. Es lo que hace que el prospecto vea la empresa
// configurada (sus estados, su separador de patente, su comprobante) y no los defaults del
// sistema. Se excluyen a propósito los campos de identidad y de ciclo de vida (`dbName`,
// `isDemoTemplate`, `demoOf`, `demoExpiresAt`), que el clon define por su cuenta.
const CONFIG_COPIABLE = [
  'cuit', 'phone', 'address',
  'receiptPrefix', 'receiptFooter', 'receiptDesign',
  'plateSeparator', 'plateFormats', 'tireCodePrefix', 'autoPrint',
  'stockStatuses',
];

// Colecciones de negocio a clonar, en orden de dependencia. Se copian los documentos TAL CUAL,
// con sus `_id` originales: es lo que mantiene vivas las refs (tire.vehicle, history.tire) sin
// tener que remapear nada.
const COLECCIONES = ['Vehicle', 'Tire', 'History', 'ReceiptCounter', 'VehicleType'];

const nombreDbDemo = () => `tenant_demo_${crypto.randomBytes(6).toString('hex')}`;

// ¿Este tenant es la plantilla de la demo? Sirve para que el login sepa que tiene que clonar
// en vez de dejar entrar al visitante a la base compartida.
export const esPlantillaDemo = (tenant) => !!tenant?.isDemoTemplate;

// ¿El tenant efímero todavía está vivo? Un demo vencido no puede seguir operando aunque su
// refresh token siga siendo criptográficamente válido.
export const demoVencido = (tenant) =>
  !!tenant?.demoExpiresAt && tenant.demoExpiresAt.getTime() <= Date.now();

// Crea el tenant descartable del visitante a partir de la plantilla.
export async function crearTenantDemo(plantilla) {
  const { Tenant } = getControlModels();
  const dbName = nombreDbDemo();

  const config = {};
  for (const clave of CONFIG_COPIABLE) {
    const valor = plantilla[clave];
    if (valor !== undefined) config[clave] = valor;
  }

  const demo = await Tenant.create({
    ...config,
    name: plantilla.name,
    dbName,
    plan: plantilla.plan,
    status: 'active',
    isDemoTemplate: false, // el clon NO se puede volver a clonar: la cadena termina acá
    demoOf: plantilla._id,
    demoExpiresAt: new Date(Date.now() + VENTANA_DEMO_MS),
  });

  const { models: origen } = getTenantDb(plantilla.dbName);
  const { models: destino } = getTenantDb(dbName);

  for (const nombre of COLECCIONES) {
    const docs = await origen[nombre].find().lean();
    if (docs.length) await destino[nombre].insertMany(docs, { ordered: false });
  }

  return demo;
}

// Borra los tenants demo vencidos y sus bases. Es lo que hace verdadera la promesa del login,
// así que corre por dos caminos: el cron diario y, de yapa, cada login de demo (barato y
// acotado, y hace que la limpieza no dependa de que el scheduler esté sano).
//
// El filtro es deliberadamente estrecho: `demoOf` presente Y `demoExpiresAt` pasado. Un tenant
// real de un cliente que paga no tiene ninguno de los dos campos, así que no hay forma de que
// entre en la selección — y esto BORRA BASES ENTERAS, no hay margen para un filtro laxo.
export async function purgarDemosVencidos() {
  const { Tenant, User } = getControlModels();

  const vencidos = await Tenant.find({
    demoOf: { $ne: null },
    demoExpiresAt: { $lt: new Date() },
  }).select('_id dbName');

  for (const t of vencidos) {
    // Primero la base de negocio, después el registro. Si el proceso muere en el medio, queda
    // un tenant sin datos (inofensivo, lo levanta la próxima corrida) y no una base huérfana
    // sin nadie que la nombre.
    await getTenantDb(t.dbName).conn.dropDatabase();
    await User.deleteMany({ tenantId: t._id });
    await Tenant.findByIdAndDelete(t._id);
  }

  return { borrados: vencidos.length, bases: vencidos.map((t) => t.dbName) };
}
