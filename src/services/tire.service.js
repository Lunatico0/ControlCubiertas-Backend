import { toCorrectionType, recalculateTireState, updateTireFromState, addHistoryEntry } from '../utils/utils.js';
import { nameByRole } from '../utils/statuses.js';
import { reconcileTireVehicleLinks } from '../utils/vehicleTires.js';
import { generatePositions } from '../utils/axles.js';
import { httpError } from '../utils/httpError.js';
import { reservarNumeroComprobante } from '../utils/receipt.js';

// Los modelos llegan por `db` (inyectado por el middleware attachDb) en vez de importarse
// globalmente. Esto habilita DB-per-tenant: el mismo service opera sobre la conexión del
// tenant que resuelva el middleware. La conexión NUNCA se guarda como estado del singleton.
class TireService {
  async getAll(db, statuses = []) {
    const tires = await db.Tire.find().populate('vehicle').lean();
    // Un tenant recién creado NO tiene cubiertas: eso es un estado válido (lista vacía),
    // no un error. Devolver [] evita el 500 en la primera pantalla de un cliente nuevo.
    if (!tires || tires.length === 0) {
      return [];
    }

    // Escalera de recapado: nombre → nivel (Nueva=0, 1er=1, 2do=2, ...). Solo cuentan los
    // roles de escalera (initial/stock); recap y discard no son un recapado en sí.
    const levelOf = {};
    let idx = 0;
    for (const s of statuses) {
      if (s?.role === 'initial' || s?.role === 'stock') levelOf[s.name] = idx++;
    }

    // Para las cubiertas fuera de la escalera (A recapar / Descartada) el status actual no
    // dice con qué recapado salieron: se toma el máximo nivel de escalera visto en su historial.
    const ladderNames = Object.keys(levelOf);
    const maxLevel = {};
    if (ladderNames.length) {
      const entries = await db.History
        .find({ status: { $in: ladderNames } })
        .select('tire status')
        .lean();
      for (const h of entries) {
        const lvl = levelOf[h.status];
        const key = String(h.tire);
        if (lvl > (maxLevel[key] ?? -1)) maxLevel[key] = lvl;
      }
    }

    return tires.map((t) => {
      const current = levelOf[t.status]; // definido si el status actual está en la escalera
      const recapLevel = current ?? maxLevel[String(t._id)] ?? 0;
      return { ...t, recapLevel };
    });
  }

  async getById(db, id) {
    const tire = await db.Tire.findById(id).populate('vehicle');
    if (!tire) throw httpError('Cubierta no encontrada', 404);

    const history = await db.History
      .find({ tire: id })
      .populate('vehicle')
      .populate('corrects')
      .sort({ date: 1 });

    return { ...tire.toObject(), history };
  }

  async getDocById(db, id) {
    const tire = await db.Tire.findById(id).populate('vehicle');
    if (!tire) throw httpError('Cubierta no encontrada', 404);
    return tire;
  }

  async findVehicleById(db, id) {
    const vehicle = await db.Vehicle.findById(id);
    if (!vehicle) throw httpError('Vehículo no encontrado', 404);
    return vehicle;
  }

  async createTire(db, data) {
    const {
      status,
      code,
      brand,
      pattern,
      serialNumber,
      size,
      kilometers = 0,
      vehicle,
      createdAt,
      orderNumber,
      receiptNumber
    } = data;

    if (!serialNumber) throw httpError('El número de serie (serialNumber) es requerido.', 400, 'serialNumber');

    const entryDate = createdAt ? new Date(createdAt) : new Date();

    const newTire = new db.Tire({
      status,
      code,
      brand,
      pattern,
      size,
      serialNumber,
      kilometers,
      vehicle: vehicle || null,
      createdAt: entryDate
    });

    await newTire.save();

    // El número se reserva recién ACÁ, con la cubierta ya guardada: un alta rechazada no deja
    // un hueco en el correlativo.
    const numero = await reservarNumeroComprobante(db, receiptNumber);

    await db.History.create({
      tire: newTire._id,
      vehicle: vehicle || null,
      km: kilometers,
      status,
      date: entryDate,
      type: 'Alta',
      orderNumber: orderNumber || null,
      receiptNumber: numero
    });

    if (vehicle) {
      await db.Vehicle.findByIdAndUpdate(vehicle, {
        $addToSet: { tires: newTire._id }
      });
    }
    newTire.receiptNumber = numero; // no se persiste: viaja en la respuesta para imprimir
    return newTire;
  }

  async assignVehicle(db, tireId, vehicleId, kmAlta, orderNumber, receiptNumber, position) {
    const tire = await this.getDocById(db, tireId);
    const vehicle = await this.findVehicleById(db, vehicleId);

    if (tire.vehicle) throw httpError('La cubierta ya está asignada a un vehículo', 409);

    // Posición opcional: si viene, debe existir en los ejes del vehículo y estar libre.
    if (position) {
      const exists = generatePositions(vehicle.axles).some((p) => p.code === position);
      if (!exists) throw httpError(`La posición ${position} no existe en este vehículo`, 400);
      const occupied = await db.Tire.findOne({ vehicle: vehicleId, position, _id: { $ne: tire._id } });
      if (occupied) throw httpError(`La posición ${position} ya está ocupada en este vehículo`, 409);
    }

    tire.vehicle = vehicleId;
    tire.position = position || null;
    vehicle.tires.push(tire._id);

    // Después de los guards de posición ocupada / cubierta ya asignada: si alguno rebota, el
    // correlativo queda intacto.
    const numero = await reservarNumeroComprobante(db, receiptNumber);

    await addHistoryEntry(db.History, tire._id, {
      type: 'Asignación',
      vehicle: vehicleId,
      status: tire.status,
      position: position || null,
      kmAlta,
      orderNumber: orderNumber || null,
      receiptNumber: numero
    });

    await vehicle.save();
    await tire.save();
    await tire.populate('vehicle');
    tire.receiptNumber = numero; // no se persiste: viaja en la respuesta para imprimir
    return tire;
  }

  async unassignVehicle(db, tireId, kmBaja, orderNumber, receiptNumber) {
    const tire = await this.getDocById(db, tireId);
    const vehicle = await this.findVehicleById(db, tire.vehicle);

    const history = await db.History
      .find({ tire: tireId })
      .sort({ date: 1 });

    const currentState = recalculateTireState(history);
    const kmAlta = currentState.lastAssignmentKm;
    const kmRecorridos = kmBaja - kmAlta;

    // t141: el mensaje trae el VALOR concreto contra el que se compara. Antes decía sólo que
    // no podía ser menor "que el de alta", y el operario tenía que cerrar el modal, ir al
    // historial, anotar el número y volver, en la acción más frecuente después de asignar.
    // El dato ya está calculado acá arriba: ponerlo en el mensaje no cuesta una query.
    if (kmRecorridos < 0) {
      throw httpError(
        `El odómetro al desmontar (${kmBaja.toLocaleString('es-AR')} km) no puede ser menor que el odómetro al montar (${kmAlta.toLocaleString('es-AR')} km).`,
        400,
        'kmBaja',
      );
    }

    // Recién acá, pasado el control de kilometraje: es justo el rechazo que quemaba números.
    const numero = await reservarNumeroComprobante(db, receiptNumber);

    tire.vehicle = null;
    tire.position = null; // al bajar del vehículo, la cubierta deja su posición libre
    tire.kilometers += kmRecorridos;

    await addHistoryEntry(db.History, tire._id, {
      type: 'Desasignación',
      status: tire.status,
      kmBaja,
      km: kmRecorridos,
      kmAlta,
      vehicle: null,
      orderNumber: orderNumber || null,
      receiptNumber: numero
    });

    const updatedHistory = await db.History.find({ tire: tireId }).sort({ date: 1 });
    const finalState = recalculateTireState(updatedHistory);
    updateTireFromState(tire, finalState);

    vehicle.tires = vehicle.tires.filter(tid => tid.toString() !== tireId);
    await vehicle.save();
    await tire.save();

    return {
      tire,
      kmAlta,
      kmBaja,
      kmRecorridos,
      receiptNumber: numero
    };
  }

  async updateTireStatus(db, tireId, status, orderNumber, receiptNumber) {
    const tire = await this.getDocById(db, tireId);
    const previousStatus = tire.status;

    tire.status = status;

    const numero = await reservarNumeroComprobante(db, receiptNumber);

    await addHistoryEntry(db.History, tire._id, {
      type: 'Estado',
      vehicle: tire.vehicle,
      status,
      orderNumber: orderNumber || null,
      receiptNumber: numero
    });

    await tire.save();
    return { tire, previousStatus, receiptNumber: numero };
  }

  async correctData(db, tireId, data) {
    const tire = await this.getDocById(db, tireId);
    const allowedFields = ['serialNumber', 'code', 'size', 'brand', 'pattern'];
    // La ruta todavía no tiene schema Zod: sin este guard, un body sin `form` tiraba un
    // TypeError de destructuring que salía como 500 con el detalle interno adentro.
    if (!data || typeof data.form !== 'object' || data.form === null) {
      throw httpError('Falta el bloque "form" con los datos de la corrección', 400, 'form');
    }
    const { reason, date, orderNumber } = data.form;

    const previousData = {};
    const editedFields = [];
    const fieldChanges = {};

    const normalize = (value) => {
      if (typeof value === 'string') return value.trim();
      if (typeof value === 'number') return String(value);
      return value ?? '';
    };

    for (const field of allowedFields) {
      const current = normalize(tire[field]);
      const incoming = normalize(data.form[field]);

      if (incoming && incoming !== current) {
        previousData[field] = tire[field];
        fieldChanges[field] = {
          before: tire[field],
          after: data.form[field]
        };
        tire[field] = data.form[field];
        editedFields.push(field);
      }
    }

    if (editedFields.length === 0) {
      throw httpError('No se detectaron cambios válidos para corregir.', 400);
    }

    const parsedDate = date && !isNaN(new Date(date)) ? new Date(date) : new Date();

    // Después del guard de "no se detectaron cambios": una corrección vacía no gasta número.
    const numero = await reservarNumeroComprobante(db, data.form.receiptNumber);

    await addHistoryEntry(db.History, tire._id, {
      type: 'Corrección-Alta',
      date: parsedDate,
      km: tire.kilometers || 0,
      vehicle: tire.vehicle || null,
      status: tire.status,
      editedFields,
      reason,
      orderNumber: orderNumber || null,
      flag: true,
      receiptNumber: numero
    });

    await tire.save();
    await tire.populate('vehicle');

    return {
      previousData,
      editedFields,
      fieldChanges,
      tire,
      receiptNumber: numero
    };
  }

  async correctHistoryEntry(db, tireId, historyId, updates) {
    const tire = await this.getDocById(db, tireId);
    const original = await db.History.findById(historyId).populate('vehicle').populate('corrects');
    // El guard va ACÁ y no veinte líneas más abajo: ahí ya se había leído original.orderNumber
    // (TypeError y 500 en vez de este 404) y, peor, ya se había reservado un número de
    // comprobante que quedaba quemado por una corrección que nunca se pudo intentar.
    if (!original) throw httpError('Entrada de historial no encontrada', 404);

    const history = await db.History.find({ tire: tire._id }).sort({ date: 1 });
    const originalOrder = original.orderNumber;
    const correctionOrder = updates.form.orderNumber;
    const receiptNumber = await reservarNumeroComprobante(db, updates.form.receiptNumber);

    const reasonOriginal = `Corregido en la orden N°${correctionOrder}`;
    const reasonCorrection = `Corrección de Orden N°${originalOrder}`;
    const userExtra = updates.form.reason?.trim() || '';


    const compareValues = (a, b) => {
      if ((a == null || a === '') && (b == null || b === '')) return false;
      return a?.toString() !== b?.toString();
    };

    const editedFields = [];
    const fieldChanges = {};

    ['kmAlta', 'kmBaja', 'status', 'vehicle'].forEach(field => {
      if (Object.hasOwn(updates.form, field)) {
        const newVal = updates.form[field];
        const oldVal = original[field];

        if (compareValues(oldVal, newVal)) {
          editedFields.push(field);
          fieldChanges[field] = {
            before: oldVal,
            after: newVal
          };
        }
      }
    });

    if (editedFields.length === 0) {
      throw httpError('No se detectaron cambios para corregir.', 400);
    }

    // Igual que en undoHistoryEntry: el tipo se captura antes de mutarlo, porque más abajo
    // la entrada NUEVA se deriva del tipo que la original TENÍA.
    const originalType = original.type;

    // Marcar original como corregida
    original.flag = true;
    original.editedFields = editedFields;
    original.reason = reasonOriginal;
    original.type = toCorrectionType(originalType);

    await original.save();

    if (editedFields.includes('status')) {
      tire.status = updates.form.status;
    }

    if (editedFields.includes('vehicle')) {
      tire.vehicle = updates.form.vehicle || null;
    }

    const clone = original.toObject();
    delete clone._id;

    const reasonFinal = userExtra && userExtra !== reasonCorrection
      ? `${reasonCorrection} ${userExtra}`
      : reasonCorrection;

    // km recalculado para las correcciones de desasignación (ver abajo).
    let kmFinal = undefined;

    // Para Correcciónes de Desasignación, calcular correctamente los km
    if (original.type === 'Desasignación' || original.type === 'Corrección-Desasignación') {
      // Obtener kmAlta y kmBaja finales
      const kmAltaFinal = updates.form.kmAlta ?? original.kmAlta ?? 0;
      const kmBajaFinal = updates.form.kmBaja ?? original.kmBaja ?? 0;

      // Si no tenemos kmAlta en la entrada original, buscar la última asignación
      let kmAltaToUse = kmAltaFinal;
      if (!kmAltaFinal && !original.kmAlta) {
        // Buscar la última asignación antes de esta entrada
        const lastAssignment = [...history]
          .reverse()
          .find(h =>
            h.type === 'Asignación' &&
            new Date(h.date) < new Date(original.date) &&
            h.kmAlta != null
          );
        kmAltaToUse = lastAssignment?.kmAlta ?? 0;
      }

      // Calcular los kilómetros recorridos
      kmFinal = kmBajaFinal - kmAltaToUse;
    }

    const newEntry = {
      ...clone,
      ...updates.form,
      tire: tireId,
      type: toCorrectionType(originalType),
      flag: true,
      editedFields,
      date: new Date(),
      reason: reasonFinal,
      vehicle: updates.form.vehicle || null,
      corrects: original._id,
      km: kmFinal, // usa el valor calculado arriba
      receiptNumber
    };

    const inserted = await db.History.create(newEntry);
    const updatedHistory = await db.History.find({ tire: tireId }).sort({ date: 1 });
    const finalState = recalculateTireState(updatedHistory);
    updateTireFromState(tire, finalState); // Aplicar estado final

    await tire.save();
    // Corregir un movimiento puede cambiar de vehículo (o sacarla de todos): alinear el otro lado.
    await reconcileTireVehicleLinks(db, tire);
    await tire.populate('vehicle');

    return {
      editedFields,
      fieldChanges,
      tire
    };
  };

  async undoHistoryEntry(db, tireId, historyId, formData, statuses = []) {
    const { orderNumber } = formData;

    const tire = await this.getDocById(db, tireId);
    const history = await db.History.find({ tire: tire._id }).sort({ date: 1 });
    const original = await db.History.findById(historyId).populate('vehicle').populate('corrects');
    if (!original) throw httpError('Entrada de historial no encontrada', 404);

    // Después de confirmar que la entrada existe: un deshacer sobre un id inválido no gasta número.
    const receiptNumber = await reservarNumeroComprobante(db, formData.receiptNumber);

    // Definir razones
    const reasonOriginal = `Deshecho en la orden N°${orderNumber}`;
    const reasonUndo = `Deshacer entrada N°${original.orderNumber}`;
    const userExtra = formData.reason?.trim() || '';
    const reasonFinal = userExtra && userExtra !== reasonUndo
      ? `${reasonUndo} ${userExtra}`
      : reasonUndo;

    // El tipo se lee ANTES de marcar la entrada: abajo se muta a la forma Corrección-*, y el
    // switch tiene que razonar sobre lo que la entrada ERA, no sobre lo que quedó.
    const originalType = original.type;

    // Marcar entrada original como deshecha
    original.flag = true;
    original.editedFields = ['Deshacer entrada'];
    original.correctedAt = new Date();
    original.reason = reasonOriginal;
    original.type = toCorrectionType(originalType);
    await original.save();

    let revertedData = {};

    // Lógica de reversión según el tipo de entrada.
    switch (originalType) {
      case 'Asignación':
      case 'Corrección-Asignación':
        // Deshacer asignación = desasignar cubierta
        revertedData = await this.handleUndoAssignment(db, tire, original, history, orderNumber, reasonFinal, receiptNumber);
        break;

      case 'Desasignación':
      case 'Corrección-Desasignación':
        // Deshacer Desasignación = reasignar a vehículo anterior
        revertedData = await this.handleUndoUnassignment(db, tire, original, history, orderNumber, reasonFinal, receiptNumber);
        break;

      case 'Estado':
      case 'Corrección-Estado':
        // Deshacer cambio de estado = volver al estado anterior
        revertedData = await this.handleUndoStatusChange(db, tire, original, history, orderNumber, reasonFinal, receiptNumber, statuses, originalType);
        break;

      case 'Alta':
      case 'Corrección-Alta':
        // Deshacer alta = marcar como eliminada (no implementado por seguridad)
        throw httpError('No se puede deshacer el alta de una cubierta: para eso hay que descartarla.', 409);

      default:
        throw httpError(`Tipo de entrada no soportado para deshacer: ${originalType}`, 400);
    }

    // Recalcular estado final
    const updatedHistory = await db.History.find({ tire: tireId }).sort({ date: 1 });
    const finalState = recalculateTireState(updatedHistory);
    updateTireFromState(tire, finalState);

    await tire.save();
    // `tire.vehicle` acaba de recalcularse desde el historial: alinear el otro lado.
    await reconcileTireVehicleLinks(db, tire);
    await tire.populate('vehicle');

    return {
      tire,
      correctedEntryId: historyId,
      newEntry: revertedData.newEntry,
      revertedTo: revertedData.revertedTo,
      receiptNumber
    };
  }

  async handleUndoAssignment(db, tire, original, history, correctionOrder, reason, receiptNumber) {
    // Crear entrada de Desasignación sin kmAlta ni kmBaja
    const newEntry = {
      tire: tire._id,
      type: 'Desasignación',
      date: new Date(),
      orderNumber: correctionOrder,
      reason: reason,
      flag: true,
      editedFields: ['Deshacer asignación'],
      vehicle: null, // Desasignar
      // No incluimos kmAlta ni kmBaja para que queden como null/undefined
      km: 0,
      status: tire.status,
      corrects: original._id,
      receiptNumber
    };

    await db.History.create(newEntry);

    return {
      newEntry,
      revertedTo: 'Cubierta desasignada'
    };
  }

  async handleUndoUnassignment(db, tire, original, history, correctionOrder, reason, receiptNumber) {
    // Buscar la última asignación antes de la Desasignación original
    const lastAssignment = [...history]
      .reverse()
      .find(entry =>
        (entry.type === 'Asignación' || entry.type === 'Corrección-Asignación') &&
        new Date(entry.date) < new Date(original.date) &&
        !entry.flag
      );

    if (!lastAssignment) {
      throw httpError('No se encontró una asignación anterior para revertir', 409);
    }

    // Obtener el kmAlta correcto de la última asignación
    const correctKmAlta = lastAssignment.kmAlta || 0;

    // Si es una corrección de Desasignación, necesitamos revertir los km
    let revertedKmBaja = original.kmBaja || 0;

    if (original.type === 'Corrección-Desasignación' && original.corrects) {
      // Buscar la entrada original que fue corregida
      const originalDesassignment = history.find(h => h._id.toString() === original.corrects.toString());
      if (originalDesassignment) {
        revertedKmBaja = originalDesassignment.kmBaja || 0;
      }
    }

    // Crear entrada de reasignación con el kmAlta correcto
    const newEntry = {
      tire: tire._id,
      type: 'Asignación',
      date: new Date(),
      orderNumber: correctionOrder,
      reason: reason,
      flag: true,
      editedFields: ['Deshacer Desasignación'],
      vehicle: lastAssignment.vehicle,
      kmAlta: correctKmAlta, // Usar el kmAlta de la asignación original
      status: tire.status,
      corrects: original._id,
      receiptNumber
    };

    await db.History.create(newEntry);

    return {
      newEntry,
      revertedTo: `Cubierta reasignada al vehículo ${lastAssignment.vehicle} con kmAlta=${correctKmAlta}`
    };
  }

  async handleUndoStatusChange(db, tire, original, history, correctionOrder, reason, receiptNumber, statuses = [], originalType = original.type) {
    // Buscar el estado anterior
    const previousStatusEntry = [...history]
      .reverse()
      .find(entry =>
        (entry.type === 'Estado' || entry.type === 'Alta') &&
        new Date(entry.date) < new Date(original.date) &&
        !entry.flag &&
        entry.status
      );

    // El estado de reversión sale del ROL, nunca de un literal: el tenant puede haber
    // renombrado su estado inicial a "0 km" y "Nueva" no existiría en su escalera.
    const estadoInicial = nameByRole(statuses, 'initial') || 'Nueva';
    let revertedStatus = estadoInicial;

    if (previousStatusEntry) {
      revertedStatus = previousStatusEntry.status;
    } else if (originalType === 'Corrección-Estado' && original.corrects) {
      // Si es una corrección, buscar la entrada original
      const originalStatusChange = history.find(h => h._id.toString() === original.corrects.toString());
      if (originalStatusChange) {
        // Buscar el estado anterior a la entrada original
        const evenEarlierStatus = [...history]
          .reverse()
          .find(entry =>
            (entry.type === 'Estado' || entry.type === 'Alta') &&
            new Date(entry.date) < new Date(originalStatusChange.date) &&
            !entry.flag &&
            entry.status
          );
        revertedStatus = evenEarlierStatus ? evenEarlierStatus.status : estadoInicial;
      }
    }

    // Crear entrada de cambio de estado
    const newEntry = {
      tire: tire._id,
      type: 'Estado',
      date: new Date(),
      orderNumber: correctionOrder,
      reason: reason,
      flag: true,
      editedFields: ['Deshacer cambio de estado'],
      status: revertedStatus,
      vehicle: tire.vehicle,
      corrects: original._id,
      receiptNumber
    };

    await db.History.create(newEntry);

    return {
      newEntry,
      revertedTo: `Estado revertido a "${revertedStatus}"`
    };
  }
}

export default new TireService();
