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

      const currentTires = Array.isArray(vehicle.tires) ? vehicle.tires.map((tire) => String(tire._id)) : [];

      // 🚨 Solución al error de falsos conflictos
      const conflictingTires = await tireModel.find({
        _id: { $in: tires.filter((tireId) => !currentTires.includes(tireId)) }, // Excluye las ya asignadas
        vehicle: { $ne: id, $ne: null },
      });

      if (conflictingTires.length > 0) {
        return res.status(400).json({
          message: "Algunas cubiertas ya están asignadas a otros vehículos",
          conflictingTires,
        });
      }

      const tiresToRemove = currentTires.filter((tireId) => !tires.includes(tireId));

      // 🚨 Agregar manejo de errores en updateMany
      try {
        await tireModel.updateMany(
          { _id: { $in: tiresToRemove } },
          { $set: { vehicle: null } }
        );
      } catch (error) {
        console.error("Error al desvincular cubiertas:", error.message);
      }

      // 🚨 Solucionar posible inconsistencia en historial
      for (const tireId of tiresToRemove) {
        const tire = await tireModel.findById(tireId);
        if (tire) {
          const previousVehicle = tire.vehicle; // Guardamos el vehículo antes de actualizar
          tire.history.push({
            vehicle: previousVehicle || null,
            km: tire.kilometers,
            status: tire.status,
          });
          await tire.save();
        }
      }

      try {
        await tireModel.updateMany(
          { _id: { $in: tires } },
          { $set: { vehicle: id } }
        );
      } catch (error) {
        console.error("Error al asignar nuevas cubiertas:", error.message);
      }

      for (const tireId of tires) {
        const tire = await tireModel.findById(tireId);
        if (tire) {
          tire.history.push({
            vehicle: id || null,
            km: tire.kilometers,
            status: tire.status,
          });
          await tire.save();
        }
      }

      vehicle.tires = tires;

      // 🚨 Eliminamos `await vehicle.save();` innecesario
      const populatedVehicle = await vehicleModel.findById(id).populate("tires");
      res.json(populatedVehicle);

    } catch (error) {
      console.error("Error al actualizar el vehículo: ", error.message);
      res.status(500).json({ message: "Error al actualizar el vehículo", error: error.message });
    }
  }
}

export default new VehicleController();
