import { z } from 'zod';

// Un eje: 'simple' (2 cubiertas), 'dual' (4) o 'moto' (rueda única, 1).
const axleItemSchema = z.object({
  type: z.enum(['simple', 'dual', 'moto']),
  label: z.string().optional(),
});

export const createVehicleSchema = z.object({
  brand: z.string().min(1),
  mobile: z.string().min(1),
  licensePlate: z.string().min(1),
  type: z.string().nullish(),
  kilometers: z.number().nonnegative().optional(),
  // Disposición de ejes (delantero→trasero); de acá se derivan las posiciones de cubiertas.
  axles: z.array(axleItemSchema).optional().default([]),
  tires: z.array(z.string()).optional().default([]),
});

// Configurar/actualizar el esquema de ejes de un vehículo existente (migración A4).
export const updateAxlesSchema = z.object({
  axles: z.array(axleItemSchema).default([]),
  kilometers: z.number().nonnegative().optional(),
});
