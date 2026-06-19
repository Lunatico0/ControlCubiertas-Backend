import { getControlModels } from '../db/controlPlane.js';
import * as authService from '../services/auth.service.js';

class AuthController {
  async login(req, res) {
    try {
      const { email, password } = req.body;
      const result = await authService.login(getControlModels(), email, password);
      res.json(result);
    } catch (error) {
      res.status(401).json({ message: error.message });
    }
  }

  async refresh(req, res) {
    try {
      const { refreshToken } = req.body;
      if (!refreshToken) return res.status(400).json({ message: 'refreshToken requerido' });
      const result = await authService.refresh(getControlModels(), refreshToken);
      res.json(result);
    } catch (error) {
      res.status(401).json({ message: error.message });
    }
  }
}

export default new AuthController();
