import { z } from 'zod';

export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  role: z.enum(['tenant-admin', 'operator']).optional(),
});

export const setUserStatusSchema = z.object({
  status: z.enum(['active', 'inactive']),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

export const receiptDesignSchema = z.object({
  logo: z.string().nullable().optional(),
  logoPos: z.enum(['left', 'center', 'right']).optional(),
  logoSize: z.enum(['S', 'M', 'L']).optional(),
  showHeader: z.boolean().optional(),
  accent: z.string().optional(),
  font: z.string().optional(),
  textSize: z.enum(['S', 'M', 'L']).optional(),
  align: z.enum(['left', 'center']).optional(),
  duplicado: z.boolean().optional(),
  sections: z.array(z.object({ key: z.string(), label: z.string(), on: z.boolean() })).optional(),
});

export const updateCompanySchema = z.object({
  name: z.string().min(1).optional(),
  cuit: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  receiptPrefix: z.string().optional(),
  receiptFooter: z.string().optional(),
  stockStatuses: z
    .array(z.object({ name: z.string().min(1), role: z.enum(['initial', 'stock', 'recap', 'discard']), color: z.string().optional() }))
    .optional(),
  receiptDesign: receiptDesignSchema.optional(),
});
