import * as userAdmin from '../services/userAdmin.service.js';
import * as company from '../services/company.service.js';
import { getTenantSummary } from '../services/stats.service.js';
import { getTenantReceipts } from '../services/receipts.service.js';
import { getTenantReports, getVehicleReports } from '../services/reports.service.js';

// Panel de administración (tenant-admin). Opera sobre el CONTROL PLANE; el tenant
// se toma SIEMPRE de req.auth.tenantId (nunca del body), así un admin no puede
// tocar usuarios de otro tenant.
class AdminController {
  async listUsers(req, res) {
    try {
      res.json(await userAdmin.listUsers(req.auth.tenantId));
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }

  async createUser(req, res) {
    try {
      const result = await userAdmin.createUser(req.auth.tenantId, req.body);
      res.status(201).json(result);
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

  async getCompany(req, res) {
    try {
      res.json(await company.getCompany(req.auth.tenantId));
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }

  async updateCompany(req, res) {
    try {
      res.json(await company.updateCompany(req.auth.tenantId, req.body));
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  }

  async summary(req, res) {
    try {
      res.json(await getTenantSummary(req.auth.dbName, await company.getTenantStatuses(req.auth.tenantId)));
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }

  async receipts(req, res) {
    try {
      res.json(await getTenantReceipts(req.auth.dbName, req.query));
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }

  async reports(req, res) {
    try {
      res.json(await getTenantReports(req.auth.dbName, await company.getTenantStatuses(req.auth.tenantId), req.query));
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }

  async vehicleReports(req, res) {
    try {
      res.json(await getVehicleReports(req.auth.dbName));
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
}

export default new AdminController();
