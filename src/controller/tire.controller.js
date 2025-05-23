import tireModel from "../models/tire.model.js";
import vehicleModel from "../models/vehicle.model.js";

class TireController {
  async getAll(req, res) {
    try {
      const tires = await tireModel
        .find()
        .populate('vehicle')
        .populate('history.vehicle');

      res.json(tires);
    } catch (error) {
      console.error('Error en getAll:', error);
      res.status(500).json({ message: error.message });
    }
  }

  async getById(req, res) {
    try {
      const { id } = req.params;

      const tire = await tireModel
        .findById(id)
        .populate('vehicle') // Vehículo actualmente asignado
        .populate('history.vehicle'); // Vehículos históricos de cada entrada

      if (!tire) return res.status(404).json({ message: 'Tire not found' });

      res.json(tire);
    } catch (error) {
      console.error('Error en getById:', error);
      res.status(500).json({ message: error.message });
    }
  }

  async create(req, res) {
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
    } = req.body;

    try {
      // Validar campos obligatorios manualmente si querés mensajes más claros
      if (!serialNumber) {
        return res.status(400).json({ message: 'El número de serie (serialNumber) es requerido.' });
      }

      const entryDate = createdAt ? new Date(createdAt) : new Date();

      // Si viene un vehicle, verificar que exista
      let assignedVehicle = null;
      if (vehicle) {
        const foundVehicle = await vehicleModel.findById(vehicle);
        if (!foundVehicle) {
          return res.status(404).json({ message: 'Vehículo no encontrado.' });
        }
        assignedVehicle = vehicle;

        // Agregar esta cubierta al vehículo
        await vehicleModel.findByIdAndUpdate(vehicle, {
          $addToSet: { tires: null } // después seteamos el ID real
        });
      }

      // Crear la cubierta
      const newTire = new tireModel({
        status,
        code,
        brand,
        pattern,
        serialNumber,
        kilometers,
        vehicle: assignedVehicle,
      });

      if (createdAt) {
        newTire.createdAt = entryDate;
      }

      // Registrar historial
      newTire.history.push({
        vehicle: assignedVehicle || null,
        km: kilometers,
        status: status,
        date: entryDate,
        type: assignedVehicle ? 'asignacion' : 'estado',
        orderNumber: orderNumber || null,
      });


      await newTire.save();

      // Actualizar el ID de la cubierta en el vehículo, si corresponde
      if (assignedVehicle) {
        await vehicleModel.findByIdAndUpdate(assignedVehicle, {
          $addToSet: { tires: newTire._id }
        });
      }

      res.status(201).json(newTire);
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  }

  async updateStatus(req, res) {
    try {
      const { id } = req.params;
      const { status, orderNumber } = req.body;

      if (!status) {
        return res.status(400).json({ message: 'El estado es requerido.' });
      }

      const validStatuses = [
        'Nueva',
        '1er Recapado',
        '2do Recapado',
        '3er Recapado',
        'A recapar',
        'Descartada',
      ];

      if (!validStatuses.includes(status)) {
        return res.status(400).json({ message: 'Estado inválido.' });
      }

      const tire = await tireModel.findById(id).populate('vehicle');

      if (!tire) {
        return res.status(404).json({ message: 'Cubierta no encontrada.' });
      }

      const previousStatus = tire.status;
      const vehicleId = tire.vehicle?._id || null;

      // Solo actualiza el estado y agrega al historial
      const updatedTire = await tireModel.findByIdAndUpdate(
        id,
        {
          $set: {
            status
          },
          $push: {
            history: {
              date: new Date(),
              vehicle: vehicleId,
              status,
              type: 'estado',
              orderNumber: orderNumber || null
            }
          }
        },
        { new: true, runValidators: true }
      );

      return res.status(200).json({
        message: `Estado actualizado de "${previousStatus}" a "${status}".`,
        tire: updatedTire
      });

    } catch (error) {
      console.error('Error al actualizar estado:', error);
      return res.status(500).json({ message: 'Error del servidor al actualizar estado.' });
    }
  }

  async assignVehicle(req, res) {
    try {
      const tireId = req.params.id;
      const { vehicle: vehicleId, kmAlta, orderNumber } = req.body;

      if (typeof kmAlta !== 'number') {
        return res.status(400).json({ message: 'Kilómetros de alta (kmAlta) requeridos.' });
      }

      const tire = await tireModel.findById(tireId);
      if (!tire) return res.status(404).json({ message: "Cubierta no encontrada" });

      if (tire.vehicle) {
        return res.status(400).json({
          message: "La cubierta ya está asignada a un vehículo",
          currentVehicle: tire.vehicle,
        });
      }

      const vehicle = await vehicleModel.findById(vehicleId);
      if (!vehicle) return res.status(404).json({ message: "Vehículo no encontrado" });

      if (!Array.isArray(vehicle.tires)) vehicle.tires = [];

      tire.vehicle = vehicleId;

      tire.history.push({
        date: new Date(),
        type: "asignacion",
        vehicle: vehicleId,
        status: tire.status,
        kmAlta,
        orderNumber: orderNumber || null
      });

      vehicle.tires.push(tire._id);

      await tire.save();
      await vehicle.save();

      return res.status(200).json({
        message: "Cubierta asignada correctamente",
        tireId: tire._id,
        vehicleId: vehicle._id,
      });

    } catch (error) {
      console.error("Error al asignar cubierta:", error);
      return res.status(500).json({
        message: `Error al asignar cubierta: ${error.message}`,
        error: error.message,
      });
    }
  }

  async unassignVehicle(req, res) {
    try {
      const { id } = req.params;
      const { kmBaja, orderNumber } = req.body;

      if (typeof kmBaja !== 'number') {
        return res.status(400).json({ message: 'Kilómetros de baja (kmBaja) requeridos.' });
      }

      const tire = await tireModel.findById(id);
      if (!tire) return res.status(404).json({ message: 'Cubierta no encontrada.' });

      const vehicleId = tire.vehicle;
      if (!vehicleId) {
        return res.status(400).json({ message: 'La cubierta no está asignada a ningún vehículo.' });
      }

      const vehicle = await vehicleModel.findById(vehicleId);
      if (!vehicle) return res.status(404).json({ message: 'Vehículo no encontrado.' });

      if (!Array.isArray(vehicle.tires)) vehicle.tires = [];

      vehicle.tires = vehicle.tires.filter(tid => tid.toString() !== id);
      await vehicle.save();

      // Buscar último kmAlta del historial
      const lastAssign = [...tire.history].reverse().find(h => h.type === 'asignacion' && h.kmAlta != null);

      let kmAlta = lastAssign?.kmAlta ?? 0;
      const kmRecorridos = kmBaja - kmAlta;

      // Validar que kmBaja sea mayor que kmAlta
      if (kmRecorridos < 0) {
        return res.status(400).json({ message: 'Kilometraje de baja no puede ser menor que el de alta.' });
      }

      // Actualizar km totales de la cubierta
      tire.kilometers += kmRecorridos;
      tire.vehicle = null;

      tire.history.push({
        date: new Date(),
        type: 'desasignacion',
        vehicle: null,
        status: tire.status,
        kmBaja,
        km: kmRecorridos,
        orderNumber: orderNumber || null
      });

      await tire.save();

      const populatedTire = await tireModel.findById(id).populate('vehicle');

      return res.status(200).json({
        message: 'Cubierta desasignada con éxito.',
        previousData: {
          vehicle,
          kmAlta,
          kmBaja,
          kmRecorridos
        },
        tire: populatedTire
      });

    } catch (error) {
      console.error('Error al desasignar cubierta:', error);
      return res.status(500).json({
        message: `Error del servidor al desasignar cubierta: ${error.message}`,
        error: error.message,
      });
    }
  }

  async correctData(req, res) {
    try {
      const { id } = req.params;
      const allowedFields = ['serialNumber', 'code', 'brand', 'pattern'];
      const { reason, date, orderNumber } = req.body;

      const tire = await tireModel.findById(id);
      if (!tire) return res.status(404).json({ message: "La cubierta no existe." });

      const previousData = {};
      const editedFields = [];

      for (const field of allowedFields) {
        if (req.body[field] && req.body[field] !== tire[field]) {
          previousData[field] = tire[field];
          tire[field] = req.body[field];
          editedFields.push(field);
        }
      }

      if (editedFields.length === 0) {
        return res.status(400).json({ message: "No se detectaron cambios válidos para corregir." });
      }

      const parsedDate = date && !isNaN(new Date(date)) ? new Date(date) : new Date();

      tire.history.push({
        type: 'correccion',
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

      return res.status(200).json({
        message: "Corrección registrada con éxito.",
        previousData,
        editedFields,
        tire
      });

    } catch (error) {
      console.error("Error al corregir datos de la cubierta:", error.message);
      res.status(500).json({ message: "Error del servidor al corregir la cubierta.", error });
    }
  }
}

export default new TireController();
