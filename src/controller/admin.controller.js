import * as userAdmin from '../services/userAdmin.service.js';
import * as company from '../services/company.service.js';

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
}

export default new AdminController();
