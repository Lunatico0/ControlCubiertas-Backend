// Valida req.body contra un schema Zod ANTES de tocar la DB. Si falla, 400 con el
// detalle de los campos. Si pasa, reemplaza req.body por los datos validados/limpios.
export const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      message: 'Datos inválidos',
      errors: result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    });
  }
  req.body = result.data;
  next();
};
