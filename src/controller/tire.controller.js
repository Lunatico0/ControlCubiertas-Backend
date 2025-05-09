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
    const { status, code, brand, pattern, kilometers, vehicle, createdAt } = req.body;
    try {
      const newTire = new tireModel({ status, code, brand, pattern, kilometers, vehicle });

      if (createdAt) {
        newTire.createdAt = createdAt;
      }

      const entryDate = createdAt ? new Date(createdAt) : new Date();

      newTire.history.push({
        vehicle: newTire.vehicle || null,
        km: newTire.kilometers || 0,
        status: newTire.status,
        date: entryDate, // Asegurar que 'date' en el historial se registre correctamente
      });

      await newTire.save();
      res.status(201).json(newTire);
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  }

  async update(req, res) {
    try {
      const { id } = req.params;
      let { vehicle, status, kilometers, date, ...updateData } = req.body;

      const tire = await tireModel.findById(id);
      if (!tire) {
        return res.status(404).json({ message: "La cubierta no existe" });
      }

      let shouldUpdateHistory = false;

      // Si vehicle es una cadena vacía o null, asignarlo como null
      if (!vehicle || vehicle === "") {
        vehicle = null;
      }

      // Si el vehículo cambió, actualizar en la base de datos
      if (String(tire.vehicle) !== String(vehicle)) {
        if (tire.vehicle) {
          const prevVehicle = await vehicleModel.findById(tire.vehicle);
          if (prevVehicle && Array.isArray(prevVehicle.tires)) {
            await vehicleModel.findByIdAndUpdate(tire.vehicle, { $pull: { tires: id } });
          }
        }

        if (vehicle) {
          const newVehicle = await vehicleModel.findById(vehicle);
          if (!newVehicle) {
            return res.status(404).json({ message: "El vehículo no existe" });
          }
          if (Array.isArray(newVehicle.tires)) {
            await vehicleModel.findByIdAndUpdate(vehicle, { $addToSet: { tires: id } });
          }
        }

        tire.vehicle = vehicle;
        shouldUpdateHistory = true;
      }

      // Si el estado cambió, actualizarlo
      if (status && tire.status !== status) {
        tire.status = status;
        shouldUpdateHistory = true;
      }

      // Si los kilómetros cambiaron, actualizar
      if (kilometers && tire.kilometers !== kilometers) {
        tire.kilometers = kilometers;
        shouldUpdateHistory = true;
      }

      // Si hay cambios relevantes, agregar un nuevo historial con la fecha proporcionada o la actual
      if (shouldUpdateHistory) {
        const parsedDate = date && !isNaN(new Date(date)) ? new Date(date) : new Date();
        tire.history.push({
          date: parsedDate,
          vehicle: tire.vehicle || null,
          km: tire.kilometers || 0,
          status: tire.status,
        });
      }

      // Asignar los datos restantes y guardar
      Object.assign(tire, updateData);
      await tire.save();

      res.status(200).json({ message: "Cubierta actualizada con éxito", tire });
    } catch (error) {
      console.error("Error al actualizar la cubierta:", error.message);
      return res.status(500).json({ message: "Error al actualizar la cubierta", error });
    }
  }
}

export default new TireController();
