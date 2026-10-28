// Autor de un movimiento, como snapshot { id, name } para guardar en History (A2).
//
// Sale SIEMPRE de la sesión firmada (req.auth, ver auth.middleware.js), nunca del body: el
// autor no lo elige el cliente. `name` es el claim que agrega buildClaims (nombre del usuario,
// o su email si no tiene nombre). Un access token emitido antes de ese claim no lo trae: la
// entrada guarda solo el id, y la UI lo muestra como "Sin registro", nunca un nombre inventado.
//
// Sin sesión (scripts, seeds, servicios llamados por fuera de un request) devuelve null.
export function actorDe(req) {
  const auth = req?.auth;
  if (!auth?.userId) return null;
  return auth.name ? { id: String(auth.userId), name: auth.name } : { id: String(auth.userId) };
}

export default actorDe;
