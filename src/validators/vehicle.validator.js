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

// Configurar/actualizar el esquema de ejes de un vehículo existente. `type` = nombre del
// tipo de vehículo derivado del layout de ejes (preset o custom del tenant).
export const updateAxlesSchema = z.object({
  axles: z.array(axleItemSchema).default([]),
  kilometers: z.number().nonnegative().optional(),
  type: z.string().nullish(),
});

// Tipo de vehículo custom del tenant: nombre + layout de ejes (array de strings).
export const createVehicleTypeSchema = z.object({
  name: z.string().min(1),
  axles: z.array(z.enum(['simple', 'dual', 'moto'])).min(1),
});

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Identificador inválido');

// PUT /vehicles/details/:id — datos identificatorios del móvil. `mobile` y `licensePlate`
// son los que se validan por unicidad, así que van obligatorios y sin espacios al borde;
// sin schema, un body sin `mobile` reventaba en normalizePlate y salía como 500.
export const updateVehicleDetailsSchema = z.object({
  mobile: z.string().trim().min(1, 'El número de móvil es obligatorio'),
  licensePlate: z.string().trim().min(1, 'La patente es obligatoria'),
  brand: z.string().nullish(),
  type: z.string().nullish(),
});

// PUT /vehicles/:id — reemplaza la lista de cubiertas montadas. Los ids se usan en un
// $in contra la colección de cubiertas: validarlos evita que un string cualquiera llegue
// al cast de Mongoose.
export const updateVehicleTiresSchema = z.object({
  tires: z.array(objectId, { message: 'Debe proporcionar un array válido de cubiertas' }),
});
