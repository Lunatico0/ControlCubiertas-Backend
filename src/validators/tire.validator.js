import { z } from 'zod';

export const createTireSchema = z.object({
  // La pertenencia del estado se valida dinámicamente contra los estados del tenant
  // (tire.controller), porque el set es configurable por empresa; acá solo la forma.
  status: z.string().min(1),
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
