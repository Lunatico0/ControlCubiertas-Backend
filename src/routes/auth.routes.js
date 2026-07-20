import { Router } from 'express';
import AuthController from '../controller/auth.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.js';
import { changePasswordSchema } from '../validators/user.validator.js';

const router = Router();

router.post('/login', (req, res, next) => AuthController.login(req, res, next));
router.post('/refresh', (req, res, next) => AuthController.refresh(req, res, next));
router.post('/change-password', authenticate, validate(changePasswordSchema), (req, res, next) => AuthController.changePassword(req, res, next));

export default router;
