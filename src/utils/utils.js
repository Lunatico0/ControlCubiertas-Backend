export const toCorrectionType = (type) => {
  if (!type) return 'Corrección-Otro';
  return type.startsWith('Corrección-')
    ? type
    : `Corrección-${type}`;
};

export const addHistoryEntry = async (History, tireId, data) => {
  await History.create({
    ...data,
    date: new Date(),
    tire: tireId, // Asociar correctamente
  });
};

export const recalculateTireState = (history) => {
  let currentVehicle = null;
  let currentStatus = null;
  let totalKilometers = 0;
  let lastAssignmentKm = 0;

  const sorted = [...history].sort((a, b) => new Date(a.date) - new Date(b.date));

  const correctedIds = new Set(sorted.filter(e => e.corrects).map(e => e.corrects.toString()));
  const validEntries = sorted.filter(entry => !correctedIds.has(entry._id.toString()));

  for (const entry of validEntries) {
    switch (entry.type) {
      case 'Alta':
      case 'Corrección-Alta':
      case 'Estado':
      case 'Corrección-Estado':
        if (entry.status) currentStatus = entry.status;
        break;

      case 'Asignación':
      case 'Corrección-Asignación':
        currentVehicle = entry.vehicle;
        if (typeof entry.kmAlta === 'number') {
          lastAssignmentKm = entry.kmAlta;
        }
        break;

      case 'Desasignación':
      case 'Corrección-Desasignación': {
        currentVehicle = null;
        const kmAlta = (typeof entry.kmAlta === 'number') ? entry.kmAlta : lastAssignmentKm;
        const kmBaja = entry.kmBaja ?? 0;
        const diff = kmBaja - kmAlta;
        if (!isNaN(diff) && diff > 0) totalKilometers += diff;
        break;
      }

      default:
        break;
    }
  }

  return {
    currentVehicle,
    currentStatus,
    totalKilometers,
    lastAssignmentKm
  };
};

// Id de una ref que puede venir populada (documento con _id) o cruda (ObjectId / string).
export const idOf = (ref) => (ref ? String(ref._id ?? ref) : null);

export const updateTireFromState = (tireDoc, state) => {
  // Un código de posición (E1-D, E2-DE, ...) solo significa algo en el vehículo donde se tomó.
  // Si la cubierta queda sin vehículo, o pasa a OTRO, la posición vieja se limpia: si no,
  // queda "E1-D" en depósito (S7) o la posición del camión viejo sobre el nuevo (N6). Quien
  // restaura una posición válida (deshacer una desasignación) la setea después de esto.
  if (!state.currentVehicle || idOf(state.currentVehicle) !== idOf(tireDoc.vehicle)) {
    tireDoc.position = null;
  }
  tireDoc.vehicle = state.currentVehicle;
  tireDoc.status = state.currentStatus;
  tireDoc.kilometers = state.totalKilometers;
};
