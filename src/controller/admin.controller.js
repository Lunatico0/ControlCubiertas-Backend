import * as userAdmin from '../services/userAdmin.service.js';
import * as company from '../services/company.service.js';
import { getTenantSummary } from '../services/stats.service.js';
import { getTenantReceipts } from '../services/receipts.service.js';
import { getTenantReports, getVehicleReports, getVehicleWear } from '../services/reports.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// Panel de administración (tenant-admin). Opera sobre el CONTROL PLANE; el tenant
// se toma SIEMPRE de req.auth.tenantId (nunca del body), así un admin no puede
// tocar usuarios de otro tenant.
//
// Los handlers de escritura de usuarios (create/update/setStatus/resetPassword) y de empresa
// (updateCompany) se dejan con try/catch a propósito: hoy mapean CUALQUIER error a 400. El
// middleware central solo puede reproducir "status || 500", así que forzar 400 a un error
// inesperado (que no sea httpError) exige el catch. El resto (lecturas → 500) se convirtió.
class AdminController {
  listUsers = asyncHandler(async (req, res) => {
    res.json(await userAdmin.listUsers(req.auth.tenantId));
  });

  async createUser(req, res) {
    try {
      const result = await userAdmin.createUser(req.auth.tenantId, req.body);
      res.status(201).json(result);
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  }

  async updateUser(req, res) {
    try {
      const user = await userAdmin.updateUser(req.auth.tenantId, req.auth.userId, req.params.id, req.body);
      res.json(user);
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  }

  async setUserStatus(req, res) {
    try {
      const user = await userAdmin.setUserStatus(req.auth.tenantId, req.params.id, req.body.status);
      res.json(user);
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  }

  async resetPassword(req, res) {
    try {
      const result = await userAdmin.resetPassword(req.auth.tenantId, req.params.id);
      res.json(result); // { user, tempPassword } — la temporal se muestra UNA vez
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  }

  getCompany = asyncHandler(async (req, res) => {
    res.json(await company.getCompany(req.auth.tenantId));
  });

  async updateCompany(req, res) {
    try {
      res.json(await company.updateCompany(req.auth.tenantId, req.body));
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  }

  summary = asyncHandler(async (req, res) => {
    res.json(await getTenantSummary(req.auth.dbName, await company.getTenantStatuses(req.auth.tenantId)));
  });

  receipts = asyncHandler(async (req, res) => {
    res.json(await getTenantReceipts(req.auth.dbName, req.query));
  });

  reports = asyncHandler(async (req, res) => {
    res.json(await getTenantReports(req.auth.dbName, await company.getTenantStatuses(req.auth.tenantId), req.query));
  });

  vehicleReports = asyncHandler(async (req, res) => {
    res.json(await getVehicleReports(req.auth.dbName, await company.getTenantStatuses(req.auth.tenantId)));
  });

  vehicleWear = asyncHandler(async (req, res) => {
    res.json(await getVehicleWear(req.auth.dbName, req.params.id, await company.getTenantStatuses(req.auth.tenantId)));
  });
}

export default new AdminController();
