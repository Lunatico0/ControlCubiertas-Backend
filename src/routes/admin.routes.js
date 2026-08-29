import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { purgarDemosVencidos } from '../services/demo.service.js';
import AdminController from '../controller/admin.controller.js';
import { authenticate, requireRole, requireActiveTenant } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.js';
import { createUserSchema, setUserStatusSchema, updateUserSchema, updateCompanySchema } from '../validators/user.validator.js';

const router = Router();

// ---------------------------------------------------------------------------------------
// Purga de tenants demo vencidos. VA ANTES del router.use(authenticate) a propósito: Express
// resuelve en orden, y este endpoint NO lo llama un usuario sino el cron de Vercel, que no
// tiene sesión. Se autentica con un secreto compartido (DEMO_PURGE_SECRET).
//
// Esto BORRA BASES DE DATOS ENTERAS. Dos decisiones deliberadas:
//   - Sin la env var configurada el endpoint responde 404, o sea que queda APAGADO. Un
//     endpoint destructivo que se cae a "sin auth" porque falta una variable es exactamente
//     cómo se pierde una base.
//   - La comparación del secreto es de tiempo constante: es un secreto de larga vida y
//     expuesto a internet.
// GET además de POST: Vercel Cron invoca con GET. Sin el GET, el cron devolvería 404 en
// silencio y la demo se llenaría de tenants muertos sin que nadie se entere.
router.all('/demo/purge', async (req, res, next) => {
  try {
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ message: 'Método no permitido' });
    // CRON_SECRET es la variable que Vercel setea sola para sus crons; DEMO_PURGE_SECRET
    // permite dispararlo a mano sin depender de ella.
    const esperado = process.env.DEMO_PURGE_SECRET || process.env.CRON_SECRET;
    if (!esperado) return res.status(404).json({ message: 'No encontrado' });

    const recibido = (req.headers.authorization || '').replace(/^Bearer /, '');
    const a = Buffer.from(recibido);
    const b = Buffer.from(esperado);
    const ok = a.length === b.length && timingSafeEqual(a, b);
    if (!ok) return res.status(401).json({ message: 'No autorizado' });

    res.json(await purgarDemosVencidos());
  } catch (err) {
    next(err);
  }
});

// Todo el panel es admin-only y opera sobre el control plane (NO usa attachDb).
router.use(authenticate, requireActiveTenant, requireRole('tenant-admin'));

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
