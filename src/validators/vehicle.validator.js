import { z } from 'zod';

export const createVehicleSchema = z.object({
  brand: z.string().min(1),
  mobile: z.string().min(1),
  licensePlate: z.string().min(1),
  type: z.string().nullish(),
  kilometers: z.number().nonnegative().optional(),
  // Disposición de ejes (delantero→trasero); de acá se derivan las posiciones de cubiertas.
  axles: z
    .array(
      z.object({
        type: z.enum(['simple', 'dual', 'moto']),
        label: z.string().optional(),
      }),
    )
    .optional()
    .default([]),
  tires: z.array(z.string()).optional().default([]),
});
