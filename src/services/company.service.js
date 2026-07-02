import { getControlModels } from '../db/controlPlane.js';
import { getTenantDb } from '../db/tenantConnections.js';
import { normalizeStatuses, assertValidStatuses } from '../utils/statuses.js';

// Config de la empresa (tenant) editable por el tenant-admin. Campos del sistema
// (dbName, plan, status) NO se tocan acá — solo los administra el provisioning/super-admin.
const EDITABLE = ['name', 'cuit', 'phone', 'address', 'receiptPrefix', 'receiptFooter', 'stockStatuses', 'receiptDesign'];

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
  if (!tenant) throw new Error('Empresa no encontrada');
  return serialize(tenant);
}

// Estados del tenant normalizados — para que la capa de tire valide pertenencia y resuelva roles.
export async function getTenantStatuses(tenantId) {
  const { Tenant } = getControlModels();
  const tenant = await Tenant.findById(tenantId).select('stockStatuses');
  return normalizeStatuses(tenant?.stockStatuses);
}

export async function updateCompany(tenantId, data) {
  const { Tenant } = getControlModels();
  const current = await Tenant.findById(tenantId);
  if (!current) throw new Error('Empresa no encontrada');

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
          throw new Error(`No se puede eliminar o renombrar el estado "${name}": ${count} cubierta(s) lo usan. Reasignalas primero.`);
        }
      }
    }
  }

  const tenant = await Tenant.findByIdAndUpdate(tenantId, update, { new: true, runValidators: true });
  if (!tenant) throw new Error('Empresa no encontrada');
  return serialize(tenant);
}
