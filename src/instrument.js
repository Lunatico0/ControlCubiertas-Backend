import { config } from "dotenv"
import * as Sentry from "@sentry/node"
import { sentryHabilitado } from "./utils/sentryEnabled.js"

// Se importa PRIMERO (antes que express) desde app.js. dotenv aca porque el config() de app.js
// todavia no corrio en ese punto → sin esto, SENTRY_DSN leido del .env no estaria seteado.
config()

// Sentry solo con DSN y en produccion (NODE_ENV o VERCEL_ENV), o con SENTRY_DEV=true para
// depurarlo en local. Nunca en tests (jest setea NODE_ENV=test). El criterio vive en
// utils/sentryEnabled.js.
export const sentryEnabled = sentryHabilitado(process.env)

if (sentryEnabled) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    // Foco en errores. Tracing de performance (tracesSampleRate) queda para habilitar mas
    // adelante; en ESM la auto-instrumentacion de tracing pide `node --import`, pero la captura
    // de errores (setupExpressErrorHandler / captureException) funciona igual sin ese flag.
  })
}
