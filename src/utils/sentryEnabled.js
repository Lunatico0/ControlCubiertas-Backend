// Decide si el backend reporta a Sentry. Función pura sobre el entorno para poder probarla sin
// tocar process.env ni inicializar el SDK.
//
// Mismo criterio que el front (main.jsx): sólo en producción, o a pedido con SENTRY_DEV=true
// para depurar el propio Sentry desde local. Antes bastaba con tener DSN: el backend local de
// QA reportaba al mismo proyecto que producción y cada corrida disparaba alertas por mail (I1).
// En tests nunca, ni siquiera con SENTRY_DEV: los tests no mandan nada ni gastan cuota.
//
// Ojo: si un deploy de preview de Vercel corre con NODE_ENV=production, también reporta (con
// environment "production"). El que distingue production de preview es VERCEL_ENV.
export const sentryHabilitado = (env) =>
  Boolean(
    env.SENTRY_DSN &&
      env.NODE_ENV !== 'test' &&
      (env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production' || env.SENTRY_DEV === 'true'),
  );
