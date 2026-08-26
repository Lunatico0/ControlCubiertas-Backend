import rateLimit from 'express-rate-limit';

// Throttling del login. El login vive en el CONTROL PLANE, que es la puerta de entrada a
// TODOS los tenants: sin límite, un ataque de fuerza bruta pega contra la base central, y en
// Vercel cada intento es además una invocación facturada.
//
// LIMITACIÓN CONOCIDA (serverless): el store es en memoria y cada invocación de Vercel puede
// levantar su propia instancia, así que el conteo NO es global. Igual sube el costo del
// ataque y frena el caso común (un mismo proceso caliente recibiendo la ráfaga). Un límite
// realmente global necesitaría un store compartido (Redis/Upstash), que es otra decisión.
//
// Solo cuentan los intentos FALLIDOS: un operario que entra bien diez veces en el día no se
// come el límite.
const numero = (valor, porDefecto) => {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : porDefecto;
};

export const loginRateLimit = rateLimit({
  windowMs: numero(process.env.LOGIN_RATE_WINDOW_MS, 15 * 60 * 1000),
  limit: numero(process.env.LOGIN_RATE_LIMIT, 10),
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Mensaje genérico: no distingue si el usuario existe ni cuántos intentos quedan.
  handler: (req, res) =>
    res.status(429).json({ message: 'Demasiados intentos fallidos. Esperá unos minutos y volvé a probar.' }),
});
