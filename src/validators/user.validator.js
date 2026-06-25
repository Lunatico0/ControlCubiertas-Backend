import { z } from 'zod';

export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  role: z.enum(['tenant-admin', 'operator']).optional(),
});

export const setUserStatusSchema = z.object({
  status: z.enum(['active', 'inactive']),
});
