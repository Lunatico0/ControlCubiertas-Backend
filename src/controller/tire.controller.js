import tireModel from "../models/tire.model.js";
import vehicleModel from "../models/vehicle.model.js";

class TireController {
  async getAll(req, res) {
    try {
      const tires = await tireModel.find().populate('vehicle').populate('history.vehicle');
      res.json(tires);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }

  async getById(req, res) {
    try {
      const { id } = req.params;
      const tire = await tireModel.findById(id).populate('vehicle').populate('history.vehicle');
      if (!tire) return res.status(404).json({ message: 'Tire not found' });
      res.json(tire);
    } catch (error) {
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
      createdAt
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
      const { status } = req.body;

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
              type: 'estado'
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
      const { vehicle: vehicleId, kilometers } = req.body;

      const tire = await tireModel.findById(tireId);
      if (!tire) {
        return res.status(404).json({ message: "Cubierta no encontrada" });
      }

      // Verificar si ya está asignada
      if (tire.vehicle) {
        return res.status(400).json({
          message: "La cubierta ya está asignada a un vehículo",
          currentVehicle: tire.vehicle,
        });
      }

      // Verificar que el vehículo destino exista
      const vehicle = await vehicleModel.findById(vehicleId);
      if (!vehicle) {
        return res.status(404).json({ message: "Vehículo no encontrado" });
      }

      // Asegurarse de que tires sea array
      if (!Array.isArray(vehicle.tires)) {
        vehicle.tires = [];
      }

      // Asignar la cubierta
      tire.vehicle = vehicleId;
      tire.history.push({
        date: new Date(),
        type: "asignacion",
        vehicle: vehicleId,
        km: kilometers,
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
        message: "Error al asignar cubierta",
        error: error.message,
      });
    }
  }

  async unassignVehicle(req, res) {
    try {
      const { id } = req.params;
      const { kilometers } = req.body;

      if (typeof kilometers !== 'number') {
        return res.status(400).json({ message: 'Kilómetros son requeridos para desasignar.' });
      }

      const tire = await tireModel.findById(id).populate('vehicle');
      if (!tire) return res.status(404).json({ message: 'Cubierta no encontrada.' });
      if (!tire.vehicle) {
        return res.status(400).json({ message: 'La cubierta no está asignada a ningún vehículo.' });
      }

      const vehicleId = tire.vehicle._id;

      const previousData = {
        vehicle: tire.vehicle,
        kilometers: tire.kilometers
      };

      await vehicleModel.findByIdAndUpdate(vehicleId, { $pull: { tires: id } });

      tire.kilometers += kilometers;
      tire.vehicle = null;

      tire.history.push({
        date: new Date(),
        vehicle: vehicleId,
        km: kilometers,
        status: 'Desasignación',
        type: 'desasignacion'
      });

      await tire.save();

      return res.status(200).json({
        message: 'Cubierta desasignada con éxito.',
        previousData,
        tire
      });

    } catch (error) {
      console.error('Error al desasignar cubierta:', error);
      return res.status(500).json({
        message: 'Error del servidor al desasignar cubierta',
        error: error.message,
      });
    }
  }

  async correctData(req, res) {
    try {
      const { id } = req.params;
      const allowedFields = ['serialNumber', 'code', 'brand', 'pattern'];
      const reason = req.body.reason || 'Corrección manual de datos';
      const date = req.body.date;

      const tire = await tireModel.findById(id).populate('vehicle');
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
