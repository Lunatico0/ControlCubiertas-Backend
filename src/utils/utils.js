import historyModel from '../models/history.model.js';

export const toCorrectionType = (type) => {
  if (!type) return 'correccion-otro';
  return type.startsWith('correccion-')
    ? type
    : `correccion-${type}`;
};

export const addHistoryEntry = async (tireId, data) => {
  await historyModel.create({
    ...data,
    date: new Date(),
    tire: tireId, // Asociar correctamente
  });
};

export const recalculateTire = (tire, history) => {
  let currentVehicle = null;
  let currentStatus = null;
  let totalKilometers = 0;
  let lastAssignmentKm = 0;

  console.log("=== Recalculando cubierta ===");
  console.log("Estado inicial:", {
    currentVehicle,
    currentStatus,
    totalKilometers,
    totalEntradas: history.length,
  });

  const sortedHistory = [...history].sort((a, b) => new Date(a.date) - new Date(b.date));

  const correctedIds = new Set();
  const correctionsMap = new Map();

  // Registrar qué entradas están corregidas
  for (const entry of sortedHistory) {
    if (entry.corrects) {
      const correctionId = entry._id.toString();
      const originalId = entry.corrects.toString();
      correctionsMap.set(correctionId, originalId);
      correctedIds.add(originalId);
      console.log(`[Map] Corrección registrada: ${correctionId} corrige ${originalId}`);
    }
  }

  for (const entry of sortedHistory) {
    const entryId = entry._id.toString();

    if (correctedIds.has(entryId)) {
      console.log(`[Skip] Entrada corregida ignorada: ${entryId}`);
      continue;
    }

    console.log(`\n[Process] Procesando entrada ${entryId} tipo "${entry.type}"`);

    switch (entry.type) {
      case "alta":
        currentStatus = entry.status;
        console.log(`→ Alta: Status seteado a "${currentStatus}"`);
        break;

      case "estado":
        currentStatus = entry.status;
        console.log(`→ Estado: Status actualizado a "${currentStatus}"`);
        break;

      case "asignacion":
      case "correccion-asignacion":
        currentVehicle = entry.vehicle;
        lastAssignmentKm = entry.kmAlta ?? 0;
        console.log(`→ Asignación: Vehículo seteado a ${currentVehicle}, kmAlta=${lastAssignmentKm}`);
        break;

      case "desasignacion": {
        currentVehicle = null;
        const kmAlta = entry.kmAlta ?? lastAssignmentKm;
        const kmBaja = entry.kmBaja ?? 0;
        const km = kmBaja - kmAlta;

        if (!isNaN(km) && km > 0) {
          totalKilometers += km;
          console.log(`→ Desasignación: ${kmBaja} - ${kmAlta} = +${km}km acumulados`);
        } else {
          console.log(`→ Desasignación inválida: kmAlta=${kmAlta}, kmBaja=${kmBaja}`);
        }
        break;
      }

      case "correccion-desasignacion": {
        currentVehicle = null;

        // Para correcciones de desasignación, tratamos la entrada como una desasignación nueva
        // que reemplaza completamente a la original
        const kmAlta = entry.kmAlta ?? lastAssignmentKm;
        const kmBaja = entry.kmBaja ?? 0;
        const kmRecorridos = kmBaja - kmAlta;

        console.log(`→ Corrección de desasignación:`);
        console.log(`   ↪ kmAlta: ${kmAlta}`);
        console.log(`   ↪ kmBaja: ${kmBaja}`);
        console.log(`   ↪ kmRecorridos calculados: ${kmRecorridos}`);

        // Simplemente añadir los kilómetros recorridos de la corrección
        // (la entrada original ya fue omitida, así que no necesitamos calcular diferencias)
        if (!isNaN(kmRecorridos) && kmRecorridos > 0) {
          totalKilometers += kmRecorridos;
          console.log(`   ↪ Kilómetros añadidos: +${kmRecorridos}km`);
        } else {
          console.log(`   ↪ Kilómetros inválidos: ${kmRecorridos}`);
        }

        console.log(`   ↪ Total acumulado: ${totalKilometers}km`);
        break;
      }

      case "correccion-alta":
        if (entry.status) {
          currentStatus = entry.status;
          console.log(`→ Corrección Alta: Status actualizado a "${currentStatus}"`);
        }
        break;

      case "correccion-estado":
        if (entry.status) {
          currentStatus = entry.status;
          console.log(`→ Corrección Estado: Status actualizado a "${currentStatus}"`);
        }
        break;

      default:
        console.log(`→ Tipo desconocido: ${entry.type}`);
        break;
    }

    console.log(`→ Total acumulado: ${totalKilometers}km`);
  }

  tire.status = currentStatus;
  tire.vehicle = currentVehicle;
  tire.kilometers = totalKilometers;

  console.log("\n✅ Resultado final:");
  console.log({
    status: tire.status,
    vehicle: tire.vehicle,
    kilometers: tire.kilometers
  });

  return tire;
};
