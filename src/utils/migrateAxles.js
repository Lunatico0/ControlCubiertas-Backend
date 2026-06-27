// Migración no destructiva de un tenant al modelo de ejes (ver utils/axles.js).
// NO inventa disposiciones de ejes: el admin las configura desde la UI conociendo
// cada vehículo. Esta migración solo:
//   1. normaliza defaults en docs legacy (vehicle.kilometers → 0, tire.position → null),
//   2. reporta qué queda por configurar (vehículos sin ejes, cubiertas montadas sin posición).
// Es idempotente: una segunda corrida no modifica nada ($exists:false ya no matchea).
export async function migrateAxles(db) {
  const km = await db.Vehicle.updateMany(
    { kilometers: { $exists: false } },
    { $set: { kilometers: 0 } },
  );
  const pos = await db.Tire.updateMany(
    { position: { $exists: false } },
    { $set: { position: null } },
  );

  const vehiclesTotal = await db.Vehicle.countDocuments();
  const vehiclesWithoutAxles = await db.Vehicle.countDocuments({
    $or: [{ axles: { $exists: false } }, { axles: { $size: 0 } }],
  });
  const tiresMountedWithoutPosition = await db.Tire.countDocuments({
    vehicle: { $ne: null },
    position: null,
  });

  return {
    kilometersBackfilled: km.modifiedCount,
    positionsBackfilled: pos.modifiedCount,
    vehiclesTotal,
    vehiclesWithoutAxles,
    tiresMountedWithoutPosition,
  };
}
