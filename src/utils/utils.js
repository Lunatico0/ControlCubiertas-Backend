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
    }
  }

  for (const entry of sortedHistory) {
    const entryId = entry._id.toString();

    if (correctedIds.has(entryId)) {
      continue;
    }

    switch (entry.type) {
      case "alta":
        currentStatus = entry.status;
        break;

      case "estado":
        currentStatus = entry.status;
        break;

      case "asignacion":
      case "correccion-asignacion":
        currentVehicle = entry.vehicle;
        lastAssignmentKm = entry.kmAlta ?? 0;
        break;

      case "desasignacion": {
        currentVehicle = null;
        const kmAlta = entry.kmAlta ?? lastAssignmentKm;
        const kmBaja = entry.kmBaja ?? 0;
        const km = kmBaja - kmAlta;

        if (!isNaN(km) && km > 0) {
          totalKilometers += km;
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

        // Simplemente añadir los kilómetros recorridos de la corrección
        // (la entrada original ya fue omitida, así que no necesitamos calcular diferencias)
        if (!isNaN(kmRecorridos) && kmRecorridos > 0) {
          totalKilometers += kmRecorridos;
        }
        break;
      }

      case "correccion-alta":
        if (entry.status) {
          currentStatus = entry.status;
        }
        break;

      case "correccion-estado":
        if (entry.status) {
          currentStatus = entry.status;
        }
        break;

      default:
        break;
    }
  }

  tire.status = currentStatus;
  tire.vehicle = currentVehicle;
  tire.kilometers = totalKilometers;

  return tire;
};

export const isValidOrderNumberFormat = (orderNumber) => {
  return /^\d{4}-\d{6}$/.test(orderNumber);
};
