import tireModel from '../models/tire.model.js';
import vehicleModel from '../models/vehicle.model.js';

class TireService {
  async getAll() {
    const populatedTires = await tireModel.find().populate('vehicle').populate('history.vehicle');
    if (!populatedTires || populatedTires.length === 0) {
      throw new Error('No se encontraron cubiertas');
    }
    return populatedTires;
  }

  async getById(id) {
    const tire = await tireModel.findById(id).populate('vehicle').populate('history.vehicle');
    if (!tire) throw new Error('Cubierta no encontrada');
    return tire;
  }

  async findVehicleById(id) {
    const vehicle = await vehicleModel.findById(id);
    if (!vehicle) throw new Error('Vehículo no encontrado');
    return vehicle;
  }

  addHistoryEntry(tire, data) {
    tire.history.push({
      date: new Date(),
      ...data
    });
  }

  calculateTotalKilometers(tire) {
    return tire.history.reduce((sum, h) => sum + (h.km || 0), 0);
  }

  recalculateTireState(tire) {
    // Reset estado base
    let currentVehicle = null;
    let currentStatus = null;
    let totalKilometers = 0;

    // Recalcular en orden cronológico
    const sortedHistory = [...tire.history].sort((a, b) => new Date(a.date) - new Date(b.date));

    for (const entry of sortedHistory) {
      switch (entry.type) {
        case "alta":
          currentStatus = entry.status;
          if (entry.km) totalKilometers = entry.km;
          break;

        case "asignacion":
          currentVehicle = entry.vehicle;
          break;

        case "desasignacion":
          if (entry.km) totalKilometers += entry.km;
          currentVehicle = null;
          break;

        case "estado":
          currentStatus = entry.status;
          break;

        case "correccion-asignacion":
        case "correccion-desasignacion":
          // seguir la lógica original (asignación/desasignación)
          if (entry.kmAlta || entry.kmBaja) {
            const km = entry.kmBaja - entry.kmAlta;
            if (!isNaN(km)) totalKilometers += km;
          }
          break;

        case "correccion-alta":
          // corrección de datos base
          break;

        default:
          break;
      }
    }

    tire.status = currentStatus;
    tire.vehicle = currentVehicle;
    tire.kilometers = totalKilometers;
  }

  async getNextOrderNumber() {
    const currentYear = new Date().getFullYear().toString();

    // Buscar todos los orderNumbers válidos del año actual
    const tires = await tireModel.find({
      'history.orderNumber': { $regex: `^${currentYear}-\\d{6}$` }
    }, {
      'history.orderNumber': 1
    });

    // Extraer todos los orderNumbers del año actual
    const allOrderNumbers = tires.flatMap(tire =>
      tire.history
        .filter(h => h.orderNumber && h.orderNumber.startsWith(currentYear))
        .map(h => h.orderNumber)
    );

    let maxNumber = 0;

    for (const order of allOrderNumbers) {
      const parts = order.split('-');
      if (parts.length === 2) {
        const num = parseInt(parts[1], 10);
        if (!isNaN(num) && num > maxNumber) {
          maxNumber = num;
        }
      }
    }

    const nextNumber = maxNumber + 1;
    const padded = String(nextNumber).padStart(6, '0');
    return `${currentYear}-${padded}`;
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

    newTire.history.push({
      vehicle: vehicle || null,
      km: kilometers,
      status,
      date: entryDate,
      type: 'alta',
      orderNumber: orderNumber || null,
    });

    await newTire.save();

    if (vehicle) {
      await vehicleModel.findByIdAndUpdate(vehicle, {
        $addToSet: { tires: newTire._id }
      });
    }

    return newTire;
  }

  async assignVehicle(tireId, vehicleId, kmAlta, orderNumber) {
    const tire = await this.getById(tireId);
    const vehicle = await this.findVehicleById(vehicleId);

    if (tire.vehicle) throw new Error('La cubierta ya está asignada a un vehículo');

    tire.vehicle = vehicleId;
    vehicle.tires.push(tire._id);

    this.addHistoryEntry(tire, {
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
    const tire = await this.getById(tireId);
    const vehicle = await this.findVehicleById(tire.vehicle);

    const lastAssign = [...tire.history].reverse().find(h => h.type === 'asignacion' && h.kmAlta != null);
    const kmAlta = lastAssign?.kmAlta ?? 0;
    const kmRecorridos = kmBaja - kmAlta;

    if (kmRecorridos < 0) throw new Error('Kilometraje de baja no puede ser menor que el de alta');

    tire.vehicle = null;
    tire.kilometers += kmRecorridos;

    this.addHistoryEntry(tire, {
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
    const tire = await this.getById(tireId);
    const previousStatus = tire.status;

    tire.status = status;

    this.addHistoryEntry(tire, {
      type: 'estado',
      vehicle: tire.vehicle,
      status,
      orderNumber: orderNumber || null
    });

    await tire.save();
    return { tire, previousStatus };
  }

  async correctData(tireId, data) {
    const tire = await this.getById(tireId);
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

    this.addHistoryEntry(tire, {
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
    const tire = await this.getById(tireId);
    const original = tire.history.id(historyId);
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
    original.type = original.type.startsWith('correccion-') ? original.type : `correccion-${original.type}`;

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

    const newEntry = {
      ...clone,
      ...updates.form,
      type: original.type,
      flag: true,
      editedFields,
      date: new Date(),
      reason: reasonFinal,
      vehicle: updates.form.vehicle || null,
      km: updates.form.kmAlta && updates.form.kmBaja
        ? updates.form.kmBaja - updates.form.kmAlta
        : undefined,
    };

    tire.history.push(newEntry);
    tire.kilometers = this.recalculateTireState(tire);

    await tire.save();
    await tire.populate('vehicle');

    return {
      editedFields,
      fieldChanges,
      tire
    };
  }

  async undoHistoryEntry(tireId, historyId) {
    const tire = await this.getById(tireId);

    // Eliminar la entrada por ID
    const index = tire.history.findIndex(entry => entry._id.toString() === historyId);
    if (index === -1) throw new Error("Entrada de historial no encontrada");

    tire.history.splice(index, 1); // Eliminar del array

    // Recalcular estado
    this.recalculateTireState(tire);

    await tire.save();
    await tire.populate('vehicle');
    return tire;
  }

}

export default new TireService();
