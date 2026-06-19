import { z } from 'zod';

export const createVehicleSchema = z.object({
  brand: z.string().min(1),
  mobile: z.string().min(1),
  licensePlate: z.string().min(1),
  type: z.string().nullish(),
  tires: z.array(z.string()).optional().default([]),
});
