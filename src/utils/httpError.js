// Error de validación/negocio con código HTTP: el middleware de errores usa `error.status`
// (con fallback a 500) para distinguir input inválido (4xx) de una falla real del server (500).
// `field` es opcional: cuando se pasa, el front sabe qué campo marcar en rojo.
export const httpError = (message, status, field) =>
  Object.assign(new Error(message), { status, ...(field !== undefined ? { field } : {}) });
