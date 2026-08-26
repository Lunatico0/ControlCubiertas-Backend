import { z } from 'zod';

export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  role: z.enum(['tenant-admin', 'operator']).optional(),
});

export const setUserStatusSchema = z.object({
  status: z.enum(['active', 'inactive']),
});

export const updateUserSchema = z
  .object({
    name: z.string().min(1).optional(),
    role: z.enum(['operator', 'tenant-admin']).optional(),
  })
  .refine((data) => data.name !== undefined || data.role !== undefined, {
    message: 'Debe enviar al menos un campo para actualizar (name o role)',
  });

export const changePasswordSchema = z.object({
  // Opcional a nivel schema: en el PRIMER INGRESO (mustChangePassword) no se re-pide la
  // actual. La obligatoriedad para el cambio voluntario la valida auth.service según el flag.
  currentPassword: z.string().optional(),
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
  // Preferencias de DISPLAY (el formato fino lo valida company.service para no duplicar reglas).
  // DEBEN estar declaradas acá: validate() reemplaza req.body con lo parseado y Zod strippea las
  // claves no declaradas, así que un campo ausente del schema se guarda como 200 pero NO persiste.
  plateSeparator: z.string().optional(),
  tireCodePrefix: z.string().optional(),
  stockStatuses: z
    .array(z.object({ name: z.string().min(1), role: z.enum(['initial', 'stock', 'recap', 'discard']), color: z.string().optional() }))
    .optional(),
  receiptDesign: receiptDesignSchema.optional(),
});

// El body del login llega sin autenticar y sin filtrar: sin schema, un email que no es string
// salía como 500 con el error interno adentro ("email?.toLowerCase is not a function"). No era
// un bypass (el `?.` corta la cadena antes del filtro de Mongo), pero sí una fuga de internals.
export const loginSchema = z.object({
  email: z.string().min(1, 'Ingresá tu email'),
  password: z.string().min(1, 'Ingresá tu contraseña'),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken requerido'),
});
