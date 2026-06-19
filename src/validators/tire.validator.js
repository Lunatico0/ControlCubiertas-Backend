import { z } from 'zod';

const STATUSES = ['Nueva', '1er Recapado', '2do Recapado', '3er Recapado', 'A recapar', 'Descartada'];

export const createTireSchema = z.object({
  status: z.enum(STATUSES),
  code: z.number(),
  brand: z.string().min(1),
  pattern: z.string().min(1),
  serialNumber: z.string().min(1),
  size: z.string().min(1),
  kilometers: z.number().optional(),
  vehicle: z.string().nullish(),
  orderNumber: z.string().nullish(),
  receiptNumber: z.string().nullish(),
  createdAt: z.union([z.string(), z.date()]).optional(),
});
