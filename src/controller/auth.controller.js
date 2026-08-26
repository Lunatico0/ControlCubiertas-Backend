import { getControlModels } from '../db/controlPlane.js';
import * as authService from '../services/auth.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';

class AuthController {
  login = asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const result = await authService.login(getControlModels(), email, password);
    res.json(result);
  });

  // Se deja con try/catch a propósito: verifyRefreshToken (jwt) tira un error SIN status ante
  // un token inválido/expirado, y hoy ese caso responde 401. Con asyncHandler iría a 500.
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

  changePassword = asyncHandler(async (req, res) => {
    // Los tokens devueltos reemplazan a los de la sesión actual: el cambio de contraseña
    // invalida los refresh vivos del usuario, este incluido.
    const tokens = await authService.changePassword(getControlModels(), req.auth.userId, req.body.currentPassword, req.body.newPassword);
    res.json({ message: 'Contraseña actualizada', ...tokens });
  });
}

export default new AuthController();
