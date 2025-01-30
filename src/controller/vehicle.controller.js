import tireModel from "../models/tire.model.js";
import vehicleModel from "../models/vehicle.model.js";

class VehicleController {
  async getAll(req, res) {
    try {
      const vehicles = await vehicleModel.find().populate('tires');
      res.json(vehicles);
    } catch (error) {
      console.error("Error al obtener los vehículos: ", error.message);
      res.status(500).json({ message: error.message });
    }
  }

  async getById(req, res) {
    try {
      const { id } = req.params;
      const vehicle = await vehicleModel.findById(id).populate('tires');
      res.json(vehicle);
    } catch (error) {
      console.error("Error al obtener el vehículo: ", error.message);
      res.status(500).json({ message: error.message });
    }
  }

  async create(req, res) {
    const { brand, mobile, licensePlate, type, tires } = req.body;

    try {
      const conflictingTires = await tireModel.find({
        _id: { $in: tires },
        vehicle: { $ne: null },
      });

      if (conflictingTires.length > 0) {
        return res.status(400).json({
          message: "Algunas cubiertas ya están asignadas a otros vehículos",
          conflictingTires,
        });
      }

      const newVehicle = new vehicleModel({ brand, mobile, licensePlate, type, tires: [] });
      await newVehicle.save();

      await tireModel.updateMany(
        { _id: { $in: tires } },
        { $set: { vehicle: newVehicle._id } }
      );

      newVehicle.tires = tires;
      await newVehicle.save();

      res.status(201).json(newVehicle);
    } catch (error) {
      console.error("Error al crear el vehículo: ", error.message);
      res.status(400).json({ message: error.message });
    }
  }

  async update(req, res) {
    try {
      const { id } = req.params;
      const { tires } = req.body;

      if (!tires || !Array.isArray(tires)) {
        return res.status(400).json({ message: "Debe proporcionar un array válido de cubiertas" });
      }

      const vehicle = await vehicleModel.findById(id).populate("tires");
      if (!vehicle) {
        return res.status(404).json({ message: "Vehículo no encontrado" });
      }

      // Buscar cubiertas que ya están asignadas a otros vehículos
      const conflictingTires = await tireModel.find({
        _id: { $in: tires },
        vehicle: { $ne: id, $ne: null },
      });

      if (conflictingTires.length > 0) {
        return res.status(400).json({
          message: "Algunas cubiertas ya están asignadas a otros vehículos",
          conflictingTires,
        });
      }

      const currentTires = Array.isArray(vehicle.tires)
        ? vehicle.tires.map((tire) => String(tire._id))
        : [];

      const tiresToRemove = currentTires.filter((tireId) => !tires.includes(tireId));

      // Actualizar las cubiertas removidas para que no tengan vehículo
      await tireModel.updateMany(
        { _id: { $in: tiresToRemove } },
        { $set: { vehicle: null } }
      );

      // Agregar una entrada al historial de las cubiertas removidas
      for (const tireId of tiresToRemove) {
        const tire = await tireModel.findById(tireId);
        if (tire) {
          tire.history.push({
            vehicle: tire.vehicle || "Sin asignar",
            km: tire.kilometers,
            state: tire.status,
          });
          await tire.save();
        }
      }

      // Actualizar las cubiertas que se están asignando al vehículo
      await tireModel.updateMany(
        { _id: { $in: tires } },
        { $set: { vehicle: id } }
      );

      // Agregar una entrada al historial de las cubiertas asignadas
      for (const tireId of tires) {
        const tire = await tireModel.findById(tireId);
        if (tire) {
          tire.history.push({
            vehicle: id, // Nuevo vehículo
            km: tire.kilometers,
            state: tire.status,
          });
          await tire.save();
        }
      }

      // Actualizar el array de cubiertas del vehículo
      vehicle.tires = tires;
      const updatedVehicle = await vehicle.save();

      // Devolver el vehículo actualizado con las cubiertas pobladas
      const populatedVehicle = await vehicleModel.findById(id).populate("tires");
      res.json(populatedVehicle);

    } catch (error) {
      console.error("Error al actualizar el vehículo: ", error.message);
      res.status(500).json({ message: "Error al actualizar el vehículo", error: error.message });
    }
  }
}

export default new VehicleController();
