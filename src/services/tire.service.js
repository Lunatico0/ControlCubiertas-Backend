import tireModel from '../models/tire.model.js';
import vehicleModel from '../models/vehicle.model.js';
import historyModel from '../models/history.model.js'
import { toCorrectionType, recalculateTire, addHistoryEntry } from '../utils/utils.js';

class TireService {
  async getAll() {
    const populatedTires = await tireModel.find().populate('vehicle')
    if (!populatedTires || populatedTires.length === 0) {
      throw new Error('No se encontraron cubiertas');
    }
    return populatedTires;
  }

  async getById(id) {
    const tire = await tireModel.findById(id).populate('vehicle');
    if (!tire) throw new Error('Cubierta no encontrada');

    const history = await historyModel
      .find({ tire: id })
      .populate('vehicle')
      .populate('corrects')
      .sort({ date: 1 });

    return { ...tire.toObject(), history };
  }

  async getDocById(id) {
    const tire = await tireModel.findById(id).populate('vehicle');
    if (!tire) throw new Error('Cubierta no encontrada');
    return tire;
  }

  async findVehicleById(id) {
    const vehicle = await vehicleModel.findById(id);
    if (!vehicle) throw new Error('Vehículo no encontrado');
    return vehicle;
  }

  async createTire(data) {
    const {
      status,
      code,
      brand,
      pattern,
      serialNumber,
      kilometers = 0,
      vehicle,
      createdAt,
      orderNumber
    } = data;

    if (!serialNumber) throw new Error('El número de serie (serialNumber) es requerido.');

    const entryDate = createdAt ? new Date(createdAt) : new Date();

    const newTire = new tireModel({
      status,
      code,
      brand,
      pattern,
      serialNumber,
      kilometers,
      vehicle: vehicle || null,
      createdAt: entryDate
    });

    await newTire.save();

    await historyModel.create({
      tire: newTire._id,
      vehicle: vehicle || null,
      km: kilometers,
      status,
      date: entryDate,
      type: 'alta',
      orderNumber: orderNumber || null,
    });

    if (vehicle) {
      await vehicleModel.findByIdAndUpdate(vehicle, {
        $addToSet: { tires: newTire._id }
      });
    }
    return newTire;
  }

  async assignVehicle(tireId, vehicleId, kmAlta, orderNumber) {
    const tire = await this.getDocById(tireId);
    const vehicle = await this.findVehicleById(vehicleId);

    if (tire.vehicle) throw new Error('La cubierta ya está asignada a un vehículo');

    tire.vehicle = vehicleId;
    vehicle.tires.push(tire._id);

    await addHistoryEntry(tire._id, {
      type: 'asignacion',
      vehicle: vehicleId,
      status: tire.status,
      kmAlta,
      orderNumber: orderNumber || null
    });

    await vehicle.save();
    await tire.save();
    await tire.populate('vehicle');
    return tire;
  }

  async unassignVehicle(tireId, kmBaja, orderNumber) {
    const tire = await this.getDocById(tireId);
    const vehicle = await this.findVehicleById(tire.vehicle);

    const history = await historyModel
      .find({ tire: tireId })
      .sort({ date: 1 });

    const lastAssign = [...history].reverse().find(h => h.type === 'asignacion' && h.kmAlta != null);

    const kmAlta = lastAssign?.kmAlta ?? 0;
    const kmRecorridos = kmBaja - kmAlta;

    if (kmRecorridos < 0) throw new Error('Kilometraje de baja no puede ser menor que el de alta');

    tire.vehicle = null;
    tire.kilometers += kmRecorridos;

    await addHistoryEntry(tire._id, {
      type: 'desasignacion',
      status: tire.status,
      kmBaja,
      km: kmRecorridos,
      vehicle: null,
      orderNumber: orderNumber || null
    });

    vehicle.tires = vehicle.tires.filter(tid => tid.toString() !== tireId);
    await vehicle.save();
    await tire.save();

    return {
      tire,
      kmAlta,
      kmBaja,
      kmRecorridos
    };
  }

  async updateTireStatus(tireId, status, orderNumber) {
    const tire = await this.getDocById(tireId);
    const previousStatus = tire.status;

    tire.status = status;

    await addHistoryEntry(tire._id, {
      type: 'estado',
      vehicle: tire.vehicle,
      status,
      orderNumber: orderNumber || null
    });

    await tire.save();
    return { tire, previousStatus };
  }

  async correctData(tireId, data) {
    const tire = await this.getDocById(tireId);
    const allowedFields = ['serialNumber', 'code', 'brand', 'pattern'];
    const { reason, date, orderNumber } = data;

    const previousData = {};
    const editedFields = [];
    const fieldChanges = {};

    for (const field of allowedFields) {
      if (data[field] && data[field] !== tire[field]) {
        previousData[field] = tire[field];
        fieldChanges[field] = {
          before: tire[field],
          after: data[field]
        };
        tire[field] = data[field];
        editedFields.push(field);
      }
    }

    if (editedFields.length === 0) throw new Error("No se detectaron cambios válidos para corregir.");

    const parsedDate = date && !isNaN(new Date(date)) ? new Date(date) : new Date();

    await addHistoryEntry(tire._id, {
      type: 'correccion-alta',
      date: parsedDate,
      km: tire.kilometers || 0,
      vehicle: tire.vehicle || null,
      status: tire.status,
      editedFields,
      reason,
      orderNumber: orderNumber || null,
      flag: true
    });

    await tire.save();
    await tire.populate('vehicle');

    return {
      previousData,
      editedFields,
      fieldChanges,
      tire
    };
  }

  async correctHistoryEntry(tireId, historyId, updates) {
    const tire = await this.getDocById(tireId);
    const original = await historyModel.findById(historyId).populate('vehicle').populate('corrects');
    const history = await historyModel.find({ tire: tire._id }).sort({ date: 1 });
    const originalOrder = original.orderNumber;
    const correctionOrder = updates.form.orderNumber;

    const reasonOriginal = `Corregido en la orden N°${correctionOrder}`;
    const reasonCorrection = `Corrección de Orden N°${originalOrder}`;
    const userExtra = updates.form.reason?.trim() || '';

    if (!original) throw new Error('Entrada de historial no encontrada');

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
      throw new Error('No se detectaron cambios para corregir.');
    }

    // Marcar original como corregida
    original.flag = true;
    original.editedFields = editedFields;
    original.reason = reasonOriginal;
    original.correctedAt = new Date();
    original.type = toCorrectionType(original.type);

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

    // ✅ AQUÍ ESTÁ LA CORRECCIÓN PRINCIPAL
    let kmFinal = undefined;

    // Para correcciones de desasignación, calcular correctamente los km
    if (original.type === 'desasignacion' || original.type === 'correccion-desasignacion') {
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
            h.type === 'asignacion' &&
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
      type: toCorrectionType(original.type),
      flag: true,
      editedFields,
      date: new Date(),
      reason: reasonFinal,
      vehicle: updates.form.vehicle || null,
      corrects: original._id,
      km: kmFinal, // ✅ Usar el valor calculado correctamente
    };

    const inserted = await historyModel.create(newEntry);
    const updatedHistory = await historyModel.find({ tire: tireId }).sort({ date: 1 });
    recalculateTire(tire, updatedHistory);

    await tire.save();
    await tire.populate('vehicle');

    return {
      editedFields,
      fieldChanges,
      tire
    };
  };

  async undoHistoryEntry(tireId, historyId, formData) {
    const tire = await this.getDocById(tireId);
    const original = await historyModel.findById(historyId).populate('vehicle').populate('corrects');
    const history = await historyModel.find({ tire: tire._id }).sort({ date: 1 });
    const correctionOrder = formData.orderNumber;

    if (!original) throw new Error("Entrada de historial no encontrada");

    // Definir razones
    const reasonOriginal = `Deshecho en la orden N°${correctionOrder}`;
    const reasonUndo = `Deshacer entrada N°${original.orderNumber}`;
    const userExtra = formData.reason?.trim() || '';
    const reasonFinal = userExtra && userExtra !== reasonUndo
      ? `${reasonUndo} ${userExtra}`
      : reasonUndo;

    // Marcar entrada original como deshecha
    original.flag = true;
    original.editedFields = ['Deshacer entrada'];
    original.correctedAt = new Date();
    original.reason = reasonOriginal;
    original.type = toCorrectionType(original.type);
    await original.save();

    let revertedData = {};

    // 🎯 LÓGICA ESPECÍFICA SEGÚN EL TIPO DE ENTRADA
    switch (original.type) {
      case 'asignacion':
      case 'correccion-asignacion':
        // Deshacer asignación = desasignar cubierta
        revertedData = await this.handleUndoAssignment(tire, original, history, correctionOrder, reasonFinal);
        break;

      case 'desasignacion':
      case 'correccion-desasignacion':
        // Deshacer desasignación = reasignar a vehículo anterior
        revertedData = await this.handleUndoUnassignment(tire, original, history, correctionOrder, reasonFinal);
        break;

      case 'estado':
      case 'correccion-estado':
        // Deshacer cambio de estado = volver al estado anterior
        revertedData = await this.handleUndoStatusChange(tire, original, history, correctionOrder, reasonFinal);
        break;

      case 'alta':
      case 'correccion-alta':
        // Deshacer alta = marcar como eliminada (no implementado por seguridad)
        throw new Error('No se puede deshacer el alta de una cubierta');

      default:
        throw new Error(`Tipo de entrada no soportado para deshacer: ${original.type}`);
    }

    // Recalcular estado final
    const updatedHistory = await historyModel.find({ tire: tireId }).sort({ date: 1 });
    recalculateTire(tire, updatedHistory);

    await tire.save();
    await tire.populate('vehicle');

    return {
      tire,
      correctedEntryId: historyId,
      newEntry: revertedData.newEntry,
      revertedTo: revertedData.revertedTo
    };
  }

  async handleUndoAssignment(tire, original, history, correctionOrder, reason) {
    // Crear entrada de desasignación sin kmAlta ni kmBaja
    const newEntry = {
      tire: tire._id,
      type: 'desasignacion',
      date: new Date(),
      orderNumber: correctionOrder,
      reason: reason,
      flag: true,
      editedFields: ['Deshacer asignación'],
      vehicle: null, // Desasignar
      // No incluimos kmAlta ni kmBaja para que queden como null/undefined
      km: 0,
      status: tire.status,
      corrects: original._id
    };

    await historyModel.create(newEntry);

    return {
      newEntry,
      revertedTo: 'Cubierta desasignada'
    };
  }

  async handleUndoUnassignment(tire, original, history, correctionOrder, reason) {
    // Buscar la última asignación antes de la desasignación original
    const lastAssignment = [...history]
      .reverse()
      .find(entry =>
        (entry.type === 'asignacion' || entry.type === 'correccion-asignacion') &&
        new Date(entry.date) < new Date(original.date) &&
        !entry.flag
      );

    if (!lastAssignment) {
      throw new Error('No se encontró asignación anterior para revertir');
    }

    // Obtener el kmAlta correcto de la última asignación
    const correctKmAlta = lastAssignment.kmAlta || 0;

    // Si es una corrección de desasignación, necesitamos revertir los km
    let revertedKmBaja = original.kmBaja || 0;

    if (original.type === 'correccion-desasignacion' && original.corrects) {
      // Buscar la entrada original que fue corregida
      const originalDesassignment = history.find(h => h._id.toString() === original.corrects.toString());
      if (originalDesassignment) {
        revertedKmBaja = originalDesassignment.kmBaja || 0;
      }
    }

    // Crear entrada de reasignación con el kmAlta correcto
    const newEntry = {
      tire: tire._id,
      type: 'asignacion',
      date: new Date(),
      orderNumber: correctionOrder,
      reason: reason,
      flag: true,
      editedFields: ['Deshacer desasignación'],
      vehicle: lastAssignment.vehicle,
      kmAlta: correctKmAlta, // Usar el kmAlta de la asignación original
      status: tire.status,
      corrects: original._id
    };

    await historyModel.create(newEntry);

    return {
      newEntry,
      revertedTo: `Cubierta reasignada al vehículo ${lastAssignment.vehicle} con kmAlta=${correctKmAlta}`
    };
  }

  async handleUndoStatusChange(tire, original, history, correctionOrder, reason) {
    // Buscar el estado anterior
    const previousStatusEntry = [...history]
      .reverse()
      .find(entry =>
        (entry.type === 'estado' || entry.type === 'alta') &&
        new Date(entry.date) < new Date(original.date) &&
        !entry.flag &&
        entry.status
      );

    let revertedStatus = 'Nueva'; // Estado por defecto

    if (previousStatusEntry) {
      revertedStatus = previousStatusEntry.status;
    } else if (original.type === 'correccion-estado' && original.corrects) {
      // Si es una corrección, buscar la entrada original
      const originalStatusChange = history.find(h => h._id.toString() === original.corrects.toString());
      if (originalStatusChange) {
        // Buscar el estado anterior a la entrada original
        const evenEarlierStatus = [...history]
          .reverse()
          .find(entry =>
            (entry.type === 'estado' || entry.type === 'alta') &&
            new Date(entry.date) < new Date(originalStatusChange.date) &&
            !entry.flag &&
            entry.status
          );
        revertedStatus = evenEarlierStatus ? evenEarlierStatus.status : 'Nueva';
      }
    }

    // Crear entrada de cambio de estado
    const newEntry = {
      tire: tire._id,
      type: 'estado',
      date: new Date(),
      orderNumber: correctionOrder,
      reason: reason,
      flag: true,
      editedFields: ['Deshacer cambio de estado'],
      status: revertedStatus,
      vehicle: tire.vehicle,
      corrects: original._id
    };

    await historyModel.create(newEntry);

    return {
      newEntry,
      revertedTo: `Estado revertido a "${revertedStatus}"`
    };
  }
}

export default new TireService();
