import { Router } from 'express';
import AdminController from '../controller/admin.controller.js';
import { authenticate, requireRole } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.js';
import { createUserSchema, setUserStatusSchema } from '../validators/user.validator.js';

const router = Router();

// Todo el panel es admin-only y opera sobre el control plane (NO usa attachDb).
router.use(authenticate, requireRole('tenant-admin'));

router.get('/users', (req, res) => AdminController.listUsers(req, res));
router.post('/users', validate(createUserSchema), (req, res) => AdminController.createUser(req, res));
router.patch('/users/:id/status', validate(setUserStatusSchema), (req, res) => AdminController.setUserStatus(req, res));

export default router;
