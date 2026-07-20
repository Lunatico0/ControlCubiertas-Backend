import { Router } from 'express';
import AdminController from '../controller/admin.controller.js';
import { authenticate, requireRole } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.js';
import { createUserSchema, setUserStatusSchema, updateUserSchema, updateCompanySchema } from '../validators/user.validator.js';

const router = Router();

// Todo el panel es admin-only y opera sobre el control plane (NO usa attachDb).
router.use(authenticate, requireRole('tenant-admin'));

router.get('/users', (req, res, next) => AdminController.listUsers(req, res, next));
router.post('/users', validate(createUserSchema), (req, res, next) => AdminController.createUser(req, res, next));
router.patch('/users/:id/status', validate(setUserStatusSchema), (req, res, next) => AdminController.setUserStatus(req, res, next));
router.patch('/users/:id', validate(updateUserSchema), (req, res, next) => AdminController.updateUser(req, res, next));
router.post('/users/:id/reset-password', (req, res, next) => AdminController.resetPassword(req, res, next));

router.get('/summary', (req, res, next) => AdminController.summary(req, res, next));
router.get('/receipts', (req, res, next) => AdminController.receipts(req, res, next));
router.get('/reports', (req, res, next) => AdminController.reports(req, res, next));
router.get('/reports/vehicles', (req, res, next) => AdminController.vehicleReports(req, res, next));
router.get('/reports/vehicles/:id/wear', (req, res, next) => AdminController.vehicleWear(req, res, next));
router.get('/company', (req, res, next) => AdminController.getCompany(req, res, next));
router.patch('/company', validate(updateCompanySchema), (req, res, next) => AdminController.updateCompany(req, res, next));

export default router;
