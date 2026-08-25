// Mongoose no mantiene la back-ref entre `tire.vehicle` y `vehicle.tires[]`: cada camino que
// asigna, desasigna o reasigna tiene que tocar los DOS lados. Cuando uno solo se actualiza
// quedan refs colgadas en `vehicle.tires[]` (el Bug 3 histórico).
//
// `tire.vehicle` es la fuente de verdad — lo recalcula `recalculateTireState` a partir del
// historial. Estas funciones alinean el lado del vehículo con esa verdad.

/**
 * Deja `vehicle.tires[]` consistente con `tire.vehicle`: saca la ref de cualquier vehículo que
 * ya no corresponda y la agrega al que sí. Idempotente — se puede llamar de más sin efecto.
 *
 * Usa operadores atómicos ($pull / $addToSet) en vez de leer-modificar-guardar para no pisar
 * escrituras concurrentes sobre el mismo vehículo.
 */
export const reconcileTireVehicleLinks = async (db, tire) => {
  const target = tire.vehicle ? String(tire.vehicle._id || tire.vehicle) : null;

  await db.Vehicle.updateMany(
    { tires: tire._id, ...(target ? { _id: { $ne: target } } : {}) },
    { $pull: { tires: tire._id } },
  );

  if (target) {
    await db.Vehicle.updateOne({ _id: target }, { $addToSet: { tires: tire._id } });
  }
};

/** Saca la cubierta del array de TODOS los vehículos. Para el borrado de una cubierta. */
export const unlinkTireEverywhere = async (db, tireId) => {
  await db.Vehicle.updateMany({ tires: tireId }, { $pull: { tires: tireId } });
};
