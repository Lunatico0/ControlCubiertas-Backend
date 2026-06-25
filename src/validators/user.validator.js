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

export const updateCompanySchema = z.object({
  name: z.string().min(1).optional(),
  cuit: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  receiptPrefix: z.string().optional(),
  receiptFooter: z.string().optional(),
  stockStatuses: z.array(z.string()).optional(),
});
