import { Router } from 'express';
import AuthController from '../controller/auth.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.js';
import { changePasswordSchema } from '../validators/user.validator.js';

const router = Router();

router.post('/login', (req, res) => AuthController.login(req, res));
router.post('/refresh', (req, res) => AuthController.refresh(req, res));
router.post('/change-password', authenticate, validate(changePasswordSchema), (req, res) => AuthController.changePassword(req, res));

export default router;
