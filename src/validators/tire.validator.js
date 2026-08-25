import { z } from 'zod';

// Techo de kilometraje para UNA cubierta. No es un límite físico exacto: es el orden de magnitud
// por encima del cual el número dejó de ser un dato y pasó a ser un dedazo. Sin este tope entraba
// 999999999 sin chistar y contaminaba todos los promedios de rendimiento.
export const KM_MAX = 1_500_000;

// Tolerancia hacia adelante para la fecha de alta. El input `date` del formulario manda el día
// suelto, así que el reloj del cliente adelantado unas horas no debería rebotar un alta legítima;
// una fecha de 2030, sí.
const MARGEN_FUTURO_MS = 24 * 3600 * 1000;

const kilometraje = z
  .number()
  .int('El kilometraje tiene que ser un número entero')
  .min(0, 'El kilometraje no puede ser negativo')
  .max(KM_MAX, `El kilometraje no puede superar los ${KM_MAX.toLocaleString('es-AR')} km`);

const fechaNoFutura = z
  .union([z.string(), z.date()])
  .refine((v) => !Number.isNaN(new Date(v).getTime()), 'Fecha inválida')
  .refine((v) => new Date(v).getTime() <= Date.now() + MARGEN_FUTURO_MS, 'La fecha de alta no puede ser futura');

export const createTireSchema = z.object({
  // La pertenencia del estado se valida dinámicamente contra los estados del tenant
  // (tire.controller), porque el set es configurable por empresa; acá solo la forma.
  status: z.string().min(1),
  code: z.number().int('El código tiene que ser un número entero').positive('El código tiene que ser mayor a cero'),
  brand: z.string().min(1),
  pattern: z.string().min(1),
  serialNumber: z.string().min(1),
  size: z.string().min(1),
  kilometers: kilometraje.optional(),
  vehicle: z.string().nullish(),
  orderNumber: z.string().nullish(),
  receiptNumber: z.string().nullish(),
  createdAt: fechaNoFutura.optional(),
});

// Reutilizables por los caminos de asignación / desasignación, donde el número que entra es el
// ODÓMETRO DEL MÓVIL y no el de la cubierta, pero las cotas de "ni negativo ni absurdo" aplican igual.
export const kilometrajeSchema = kilometraje;
export const fechaNoFuturaSchema = fechaNoFutura;
