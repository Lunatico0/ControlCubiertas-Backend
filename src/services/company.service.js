import { getControlModels } from '../db/controlPlane.js';

// Config de la empresa (tenant) editable por el tenant-admin. Campos del sistema
// (dbName, plan, status) NO se tocan acá — solo los administra el provisioning/super-admin.
const EDITABLE = ['name', 'cuit', 'phone', 'address', 'receiptPrefix', 'receiptFooter', 'stockStatuses'];

export async function getCompany(tenantId) {
  const { Tenant } = getControlModels();
  const tenant = await Tenant.findById(tenantId);
  if (!tenant) throw new Error('Empresa no encontrada');
  return tenant;
}

export async function updateCompany(tenantId, data) {
  const { Tenant } = getControlModels();
  const update = {};
  for (const key of EDITABLE) {
    if (key in data) update[key] = data[key];
  }
  const tenant = await Tenant.findByIdAndUpdate(tenantId, update, { new: true, runValidators: true });
  if (!tenant) throw new Error('Empresa no encontrada');
  return tenant;
}
