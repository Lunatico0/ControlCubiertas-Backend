import { config } from "dotenv"
import * as Sentry from "@sentry/node"

// Se importa PRIMERO (antes que express) desde app.js. dotenv aca porque el config() de app.js
// todavia no corrio en ese punto → sin esto, SENTRY_DSN leido del .env no estaria seteado.
config()

// Sentry solo si hay DSN y NO estamos en tests (jest setea NODE_ENV=test): asi los tests nunca
// mandan errores a Sentry ni gastan cuota, y en dev sin DSN tampoco manda nada. En prod (Vercel)
// SENTRY_DSN llega como env var real y se activa.
export const sentryEnabled = Boolean(process.env.SENTRY_DSN && process.env.NODE_ENV !== "test")

if (sentryEnabled) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    // Foco en errores. Tracing de performance (tracesSampleRate) queda para habilitar mas
    // adelante; en ESM la auto-instrumentacion de tracing pide `node --import`, pero la captura
    // de errores (setupExpressErrorHandler / captureException) funciona igual sin ese flag.
  })
}
