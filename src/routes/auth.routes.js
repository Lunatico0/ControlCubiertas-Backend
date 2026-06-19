import { Router } from 'express';
import AuthController from '../controller/auth.controller.js';

const router = Router();

router.post('/login', (req, res) => AuthController.login(req, res));
router.post('/refresh', (req, res) => AuthController.refresh(req, res));

export default router;
