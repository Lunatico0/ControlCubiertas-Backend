import { Router } from 'express';
import AdminController from '../controller/admin.controller.js';
import { authenticate, requireRole } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.js';
import { createUserSchema, setUserStatusSchema, updateUserSchema, updateCompanySchema } from '../validators/user.validator.js';

const router = Router();

// Todo el panel es admin-only y opera sobre el control plane (NO usa attachDb).
router.use(authenticate, requireRole('tenant-admin'));

router.get('/users', (req, res) => AdminController.listUsers(req, res));
router.post('/users', validate(createUserSchema), (req, res) => AdminController.createUser(req, res));
router.patch('/users/:id/status', validate(setUserStatusSchema), (req, res) => AdminController.setUserStatus(req, res));
router.patch('/users/:id', validate(updateUserSchema), (req, res) => AdminController.updateUser(req, res));
router.post('/users/:id/reset-password', (req, res) => AdminController.resetPassword(req, res));

router.get('/summary', (req, res) => AdminController.summary(req, res));
router.get('/receipts', (req, res) => AdminController.receipts(req, res));
router.get('/reports', (req, res) => AdminController.reports(req, res));
router.get('/reports/vehicles', (req, res) => AdminController.vehicleReports(req, res));
router.get('/reports/vehicles/:id/wear', (req, res) => AdminController.vehicleWear(req, res));
router.get('/company', (req, res) => AdminController.getCompany(req, res));
router.patch('/company', validate(updateCompanySchema), (req, res) => AdminController.updateCompany(req, res));

export default router;
