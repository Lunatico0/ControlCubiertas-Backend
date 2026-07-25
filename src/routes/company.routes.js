import { Router } from 'express';
import { getCompany } from '../services/company.service.js';

// Lectura de la empresa (datos + receiptDesign) para CUALQUIER usuario autenticado.
// La escritura sigue siendo admin-only (PATCH /api/admin/company). El tenant se toma
// SIEMPRE de req.auth.tenantId (lo setea authenticate), nunca del cliente.
const router = Router();

router.get('/', async (req, res) => {
  try {
    const c = await getCompany(req.auth.tenantId);
    res.json({
      name: c.name,
      cuit: c.cuit,
      phone: c.phone,
      address: c.address,
      receiptPrefix: c.receiptPrefix,
      receiptFooter: c.receiptFooter,
      receiptDesign: c.receiptDesign,
      stockStatuses: c.stockStatuses,
      plateSeparator: c.plateSeparator,
      tireCodePrefix: c.tireCodePrefix,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
