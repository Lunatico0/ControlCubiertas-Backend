// Valida req.body contra un schema Zod ANTES de tocar la DB. Si falla, 400 con el
// detalle de los campos. Si pasa, reemplaza req.body por los datos validados/limpios.
export const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    // `message` y `field` replican el contrato de httpError para que el front pueda mostrar
    // el error EN el campo sin conocer la forma de Zod. `errors` se mantiene para el detalle.
    const primero = issues[0];
    return res.status(400).json({
      message: primero?.message || 'Datos inválidos',
      ...(primero?.path ? { field: primero.path.split('.').pop() } : {}),
      errors: issues,
    });
  }
  req.body = result.data;
  next();
};
