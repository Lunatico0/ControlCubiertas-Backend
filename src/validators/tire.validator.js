import { z } from 'zod';

// Techo de kilometraje para UNA cubierta. No es un límite físico exacto: es el orden de magnitud
// por encima del cual el número dejó de ser un dato y pasó a ser un dedazo. Sin este tope entraba
// 999999999 sin chistar y contaminaba todos los promedios de rendimiento.
export const KM_MAX = 1_500_000;

// Tolerancia hacia adelante para la fecha de alta. El input `date` del formulario manda el día
// suelto, así que el reloj del cliente adelantado unas horas no debería rebotar un alta legítima;
// una fecha de 2030, sí.
const MARGEN_FUTURO_MS = 24 * 3600 * 1000;

// El número de ORDEN es el dato que hace auditable al comprobante: es OBLIGATORIO en todos
// los caminos que emiten uno, y el backend es la FUENTE DE VERDAD (el front lo exigía por su
// cuenta mientras acá entraba vacío y con cualquier forma).
//
// Se NORMALIZA además de validarse. El motivo es concreto: el panel viejo manda el número ya
// formateado (AAAA-NNNNNN) y la operativa /op mandaba los dígitos crudos, así que en la misma
// base conviven "123" y "2026-000123" para el mismo tipo de dato. Aceptar las dos formas y
// guardar siempre la canónica cierra esa inconsistencia sin romper ningún cliente instalado.
// Los caminos que NO emiten comprobante (alta de vehículo con cubiertas) no pasan por acá.
const FORMATO_ORDEN = /^\d{4}-\d{6}$/;
const SOLO_DIGITOS = /^\d{1,6}$/;

export const normalizarNumeroDeOrden = (valor) => {
  const limpio = String(valor ?? '').trim();
  if (FORMATO_ORDEN.test(limpio)) return limpio;
  if (SOLO_DIGITOS.test(limpio) && Number(limpio) > 0) {
    return `${new Date().getFullYear()}-${limpio.padStart(6, '0')}`;
  }
  return null;
};

const numeroDeOrden = z
  .string({ error: 'El número de orden es obligatorio' })
  .trim()
  .min(1, 'El número de orden es obligatorio')
  .refine((v) => normalizarNumeroDeOrden(v) !== null, {
    error: 'El número de orden tiene que ser un número mayor a cero (o el formato AAAA-NNNNNN)',
  })
  .transform((v) => normalizarNumeroDeOrden(v));

const kilometraje = z
  .number()
  .int('El kilometraje tiene que ser un número entero')
  .min(0, 'El kilometraje no puede ser negativo')
  .max(KM_MAX, `El kilometraje no puede superar los ${KM_MAX.toLocaleString('es-AR')} km`);

// Un input `type="date"` manda un DÍA SUELTO ("2026-03-15") y `new Date()` lo lee como
// medianoche UTC: en GMT-3 eso ya es el 14 a las 21:00 y la fecha aparece corrida un día
// atrás en toda la app. Anclarlo al MEDIODÍA UTC deja 12 horas de colchón a cada lado, así
// que ninguna zona horaria real puede empujarlo a otro día. El frontend hace lo mismo con
// la hora local (@utils/date); esto es la defensa del lado del servidor, que vale para
// cualquier cliente. Un valor que ya trae hora pasa intacto.
const DIA_SUELTO = /^\d{4}-\d{2}-\d{2}$/;
export const anclarDiaSuelto = (v) =>
  (typeof v === 'string' && DIA_SUELTO.test(v.trim()) ? `${v.trim()}T12:00:00.000Z` : v);

const fechaNoFutura = z
  .union([z.string(), z.date()])
  .transform(anclarDiaSuelto)
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
  orderNumber: numeroDeOrden,
  receiptNumber: z.string().nullish(),
  createdAt: fechaNoFutura.optional(),
});

// Reutilizables por los caminos de asignación / desasignación, donde el número que entra es el
// ODÓMETRO DEL MÓVIL y no el de la cubierta, pero las cotas de "ni negativo ni absurdo" aplican igual.
export const kilometrajeSchema = kilometraje;
export const fechaNoFuturaSchema = fechaNoFutura;

// ─────────────────────────────────────────────────────────────────────────────
// Schemas de las rutas de mutación que antes no tenían ninguno. Ojo con dos cosas:
//
// 1) `validate` REEMPLAZA req.body con lo que devuelve Zod, y Zod strippea todo campo no
//    declarado. Un campo que falte acá desaparece del body sin error: hay que declarar
//    TODO lo que el controlador o el servicio leen río abajo.
// 2) `.strict()` va solo donde un campo de más termina escrito en la base. Es el caso de
//    `form` en la corrección de historial, porque el servicio hace `...updates.form` dentro
//    del documento nuevo de History. En el resto se strippea en silencio, que alcanza.
// ─────────────────────────────────────────────────────────────────────────────

// El número de COMPROBANTE es opcional: lo reserva el backend dentro de la mutación cuando
// el cliente no lo manda (ver reservarNumeroComprobante).
const referenciaOpcional = z.string().nullish();

export const updateTireStatusSchema = z.object({
  // La pertenencia al set de estados del tenant la valida el controlador (es configurable
  // por empresa); acá solo la forma.
  status: z.string().min(1, 'El estado es obligatorio'),
  orderNumber: numeroDeOrden,
  receiptNumber: referenciaOpcional,
});

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Identificador inválido');

export const assignTireSchema = z.object({
  vehicle: objectId,
  // kmAlta es el ODÓMETRO DEL MÓVIL, no el de la cubierta, pero las cotas aplican igual.
  kmAlta: kilometraje,
  position: z.string().nullish(),
  orderNumber: numeroDeOrden,
  receiptNumber: referenciaOpcional,
});

export const unassignTireSchema = z.object({
  kmBaja: kilometraje,
  orderNumber: numeroDeOrden,
  receiptNumber: referenciaOpcional,
});

// Corrección de los datos de alta. El servicio solo aplica los campos de `allowedFields`,
// así que acá alcanza con declararlos y no hace falta `.strict()`.
export const correctTireSchema = z.object({
  form: z.object({
    serialNumber: z.string().min(1).optional(),
    code: z.number().int().positive().optional(),
    size: z.string().min(1).optional(),
    brand: z.string().min(1).optional(),
    pattern: z.string().min(1).optional(),
    reason: z.string().nullish(),
    date: z.union([z.string(), z.date()]).nullish(),
    orderNumber: numeroDeOrden,
    receiptNumber: referenciaOpcional,
  }, { error: 'Falta el bloque "form" con los datos de la corrección' }),
});

// Corrección de una entrada del historial. ACÁ SÍ va `.strict()`: el servicio spreadea
// `...updates.form` dentro de la entrada nueva de History, así que sin esto el cliente
// escribe campos arbitrarios directo en la colección.
export const correctHistorySchema = z.object({
  form: z
    .object({
      kmAlta: kilometraje.optional(),
      kmBaja: kilometraje.optional(),
      status: z.string().min(1).optional(),
      vehicle: z.union([objectId, z.null()]).optional(),
      reason: z.string().nullish(),
      orderNumber: numeroDeOrden,
      receiptNumber: referenciaOpcional,
    })
    .strict('Campo no permitido en la corrección de historial'),
}, { error: 'Falta el bloque "form" con los datos de la corrección' });

export const undoHistorySchema = z.object({
  reason: z.string().nullish(),
  orderNumber: numeroDeOrden,
  receiptNumber: referenciaOpcional,
});
