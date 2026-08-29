import { getControlModels } from '../db/controlPlane.js';
import { getTenantDb } from '../db/tenantConnections.js';
import { normalizeStatuses, assertValidStatuses } from '../utils/statuses.js';
import { httpError } from '../utils/httpError.js';
import { PLATE_FORMATS_AR } from '../utils/plate.js';

// Config de la empresa (tenant) editable por el tenant-admin. Campos del sistema
// (dbName, plan, status) NO se tocan acá — solo los administra el provisioning/super-admin.
const EDITABLE = ['name', 'cuit', 'phone', 'address', 'receiptPrefix', 'receiptFooter', 'stockStatuses', 'receiptDesign', 'plateSeparator', 'plateFormats', 'tireCodePrefix', 'autoPrint'];

// Separadores de patente permitidos: vacío (ninguno) o UN solo carácter razonable. Evita que
// se cuele texto/alfanuméricos que romperían el display o el round-trip con la patente normalizada.
const PLATE_SEP_OK = /^[-_.\/·: ]$/;

// Prefijo del código interno de cubierta: vacío o hasta 10 caracteres alfanuméricos + separadores
// comunes. Es solo DISPLAY (el code sigue siendo un Number autoincremental); esto evita que se
// cuele texto raro que rompa el layout del comprobante o el ancho de las grillas.
const TIRE_PREFIX_OK = /^[A-Za-z0-9\-_.\/ ]{0,10}$/;

// Devuelve el tenant como objeto plano con stockStatuses siempre en la forma [{name,role}]
// (normaliza legacy [String] en lectura, sin tocar la DB).
function serialize(tenant) {
  const obj = tenant.toObject ? tenant.toObject() : tenant;
  obj.stockStatuses = normalizeStatuses(obj.stockStatuses);
  return obj;
}

export async function getCompany(tenantId) {
  const { Tenant } = getControlModels();
  const tenant = await Tenant.findById(tenantId);
  if (!tenant) throw httpError('Empresa no encontrada', 404);
  return serialize(tenant);
}

// Estados del tenant normalizados — para que la capa de tire valide pertenencia y resuelva roles.
export async function getTenantStatuses(tenantId) {
  const { Tenant } = getControlModels();
  const tenant = await Tenant.findById(tenantId).select('stockStatuses');
  return normalizeStatuses(tenant?.stockStatuses);
}

// Formatos de patente aceptados por el tenant (t138). Mismo patrón que getTenantStatuses: la
// config vive en el CONTROL PLANE y el controlador la pide por request, sin cachearla en un
// singleton (la conexión y el tenant viajan por request, nunca en estado de módulo).
//
// `undefined` significa "el tenant es viejo y nunca se le escribió el campo" → se cae al
// default argentino. Un array vacío GUARDADO es una decisión explícita: no validar.
export async function getTenantPlateFormats(tenantId) {
  const { Tenant } = getControlModels();
  const tenant = await Tenant.findById(tenantId).select('plateFormats');
  return tenant?.plateFormats === undefined ? PLATE_FORMATS_AR : tenant.plateFormats;
}

export async function updateCompany(tenantId, data) {
  const { Tenant } = getControlModels();
  const current = await Tenant.findById(tenantId);
  if (!current) throw httpError('Empresa no encontrada', 400);

  const update = {};
  for (const key of EDITABLE) {
    if (key in data) update[key] = data[key];
  }

  // Estados configurables: validar invariantes (initial/discard obligatorios) y bloquear
  // eliminar/renombrar un estado que ya usan cubiertas (cruza control plane ↔ data plane).
  if ('stockStatuses' in update) {
    const next = update.stockStatuses;
    assertValidStatuses(next);
    const currentNames = new Set(normalizeStatuses(current.stockStatuses).map((s) => s.name));
    const nextNames = new Set(next.map((s) => s.name));
    const removed = [...currentNames].filter((n) => !nextNames.has(n));
    if (removed.length) {
      const { Tire } = getTenantDb(current.dbName).models;
      for (const name of removed) {
        const count = await Tire.countDocuments({ status: name });
        if (count > 0) {
          throw httpError(`No se puede eliminar o renombrar el estado "${name}": ${count} cubierta(s) lo usan. Reasignalas primero.`, 400);
        }
      }
    }
  }

  if ('plateSeparator' in update) {
    const sep = update.plateSeparator;
    if (typeof sep !== 'string' || (sep !== '' && !PLATE_SEP_OK.test(sep))) {
      throw httpError('Separador de patente inválido: usá un solo carácter razonable (ej. "-", ".", "/", espacio) o dejalo vacío.', 400);
    }
  }

  // Formatos de patente: cada máscara se escribe con A (letra) y 0 (dígito), hasta 12
  // posiciones. Se limpian los separadores decorativos (la validación corre sobre la forma
  // canónica) y se descartan las entradas vacías. La lista vacía es válida: apaga la validación.
  if ('plateFormats' in update) {
    const raw = update.plateFormats;
    if (!Array.isArray(raw)) throw httpError('Los formatos de patente tienen que ser una lista.', 400);
    const limpios = raw
      .map((m) => String(m ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/[1-9]/g, '0'))
      .filter(Boolean);
    for (const m of limpios) {
      if (!/^[A0]{1,12}$/.test(m)) {
        throw httpError(`Formato de patente inválido: "${m}". Usá A para una letra y 0 para un dígito (ej. AAA000, AA000AA).`, 400);
      }
    }
    update.plateFormats = [...new Set(limpios)];
  }

  if ('tireCodePrefix' in update) {
    const prefix = update.tireCodePrefix;
    if (typeof prefix !== 'string' || (prefix !== '' && !TIRE_PREFIX_OK.test(prefix))) {
      throw httpError('Prefijo de código interno inválido: usá hasta 10 caracteres alfanuméricos o separadores comunes (ej. "T-", "CUB/"), o dejalo vacío.', 400);
    }
  }

  const tenant = await Tenant.findByIdAndUpdate(tenantId, update, { new: true, runValidators: true });
  if (!tenant) throw httpError('Empresa no encontrada', 400);
  return serialize(tenant);
}
