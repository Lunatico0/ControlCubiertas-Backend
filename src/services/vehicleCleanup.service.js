import { normalizePlate, plateMatcher } from '../utils/plate.js';

// Borrado CONSISTENTE de un vehículo. Existe para limpiar residuo (vehículos de prueba que
// quedaron de una migración o de una sesión de QA) sin romper el grafo de datos.
//
// No es un `deleteOne`, y la razón está documentada como Bug 3 en BUGS.md: **no hay back-ref
// automática en Mongoose** entre `tire.vehicle` y `vehicle.tires[]`. Borrar el documento del
// vehículo a mano deja tres cosas rotas:
//   1. Cubiertas con `tire.vehicle` apuntando a un documento que ya no existe. La app las
//      sigue creyendo montadas, así que no se pueden asignar a otro móvil sin desasignarlas
//      de un fantasma que ya no se puede abrir.
//   2. `tire.position` ocupando una posición de un esquema de ejes que se fue con el vehículo.
//   3. Entradas de historial con `history.vehicle` colgado.
//
// Lo que este servicio NO hace: borrar las cubiertas (son inventario real, sobreviven al
// vehículo) ni reescribir el historial (el movimiento ocurrió; lo único que se limpia es la
// referencia al documento borrado).

// Busca por móvil o por patente. La patente se compara con `plateMatcher`, así que encontrarlo
// no depende de si el dato está guardado con separador o sin él.
const buscar = (db, { mobile, licensePlate }) => {
  if (mobile) return db.Vehicle.findOne({ mobile });
  if (licensePlate) return db.Vehicle.findOne({ licensePlate: plateMatcher(normalizePlate(licensePlate)) });
  return null;
};

// Qué cuelga del vehículo, sin tocar nada. Mirar antes de borrar.
export async function inspeccionarVehiculo(db, criterio) {
  const vehiculo = await buscar(db, criterio);
  if (!vehiculo) return null;

  const [cubiertasMontadas, entradasDeHistorial] = await Promise.all([
    db.Tire.find({ vehicle: vehiculo._id }).select('code serialNumber position status').lean(),
    db.History.countDocuments({ vehicle: vehiculo._id }),
  ]);

  return { vehiculo, cubiertasMontadas, entradasDeHistorial };
}

// Borra el vehículo manteniendo los dos lados del grafo.
export async function borrarVehiculoConsistente(db, criterio) {
  const vehiculo = await buscar(db, criterio);
  if (!vehiculo) return { borrado: false, desasignadas: 0, historialLimpiado: 0 };

  // 1. Las cubiertas se DESASIGNAN, no se borran: son inventario real que sobrevive al móvil.
  //    Se limpia también `position`, que sin su esquema de ejes no significa nada.
  const desasignadas = await db.Tire.updateMany(
    { vehicle: vehiculo._id },
    { $set: { vehicle: null, position: null } },
  );

  // 2. El historial se conserva —el movimiento ocurrió— pero se suelta la ref al documento
  //    borrado. Un populate sobre una ref colgada devuelve null igual; la diferencia es que
  //    así el dato dice explícitamente "no hay vehículo" en vez de "hay uno que no encuentro".
  const historialLimpiado = await db.History.updateMany(
    { vehicle: vehiculo._id },
    { $set: { vehicle: null } },
  );

  await db.Vehicle.deleteOne({ _id: vehiculo._id });

  return {
    borrado: true,
    vehiculo: { mobile: vehiculo.mobile, licensePlate: vehiculo.licensePlate },
    desasignadas: desasignadas.modifiedCount ?? 0,
    historialLimpiado: historialLimpiado.modifiedCount ?? 0,
  };
}
