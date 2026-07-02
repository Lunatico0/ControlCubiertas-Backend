import { getTenantDb } from '../db/tenantConnections.js';

// Resumen de la flota del tenant (para el panel). Lee la DB del tenant y agrega.
// "vehículos sin cubiertas" se calcula por las cubiertas asignadas (tire.vehicle),
// no por vehicle.tires[], para no depender de refs colgadas (Bug 3).
export async function getTenantSummary(dbName, statuses = null) {
  const { Tire, Vehicle } = getTenantDb(dbName).models;

  const tires = await Tire.find().select('status vehicle').lean();
  const vehicles = await Vehicle.find().select('_id').lean();

  const total = tires.length;
  const byStatus = {};
  for (const t of tires) byStatus[t.status] = (byStatus[t.status] || 0) + 1;

  const enCirculacion = tires.filter((t) => t.vehicle).length;
  const enDeposito = total - enCirculacion;

  const vehiclesConCubierta = new Set(tires.filter((t) => t.vehicle).map((t) => String(t.vehicle)));
  const vehiculosSinCubiertas = vehicles.filter((v) => !vehiclesConCubierta.has(String(v._id))).length;

  // Señal "a recapar" por ROL (no por nombre): suma las cubiertas cuyos estados tienen
  // role 'recap'. Fallback al nombre legacy 'A recapar' si no se pasan los estados.
  const recapNames = statuses ? statuses.filter((s) => s.role === 'recap').map((s) => s.name) : ['A recapar'];
  const aRecapar = recapNames.reduce((sum, name) => sum + (byStatus[name] || 0), 0);

  return {
    cubiertas: { total, enCirculacion, enDeposito, byStatus },
    vehiculos: { total: vehicles.length, sinCubiertas: vehiculosSinCubiertas },
    senales: {
      aRecapar,
      vehiculosSinCubiertas,
    },
  };
}
