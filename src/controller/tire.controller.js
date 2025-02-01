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
    const { status, code, brand, size, pattern, kilometers, vehicle } = req.body;
    try {
      const newTire = new tireModel({ status, code, brand, size, pattern, kilometers, vehicle });
      await newTire.save();
      res.status(201).json(newTire);
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  }

  async update(req, res) {
    try {
      const { id } = req.params;
      let { vehicle, status, kilometers, ...updateData } = req.body;

      const tire = await tireModel.findById(id);
      if (!tire) {
        return res.status(404).json({ message: "La cubierta no existe" });
      }

      let shouldUpdateHistory = false;

      if (!vehicle || vehicle === "") {
        vehicle = null;
      }

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


      if (status && tire.status !== status) {
        tire.status = status;
        shouldUpdateHistory = true;
      }

      if (kilometers && tire.kilometers !== kilometers) {
        tire.kilometers = kilometers;
        shouldUpdateHistory = true;
      }

      if (shouldUpdateHistory) {
        tire.history.push({
          vehicle: tire.vehicle || null,
          km: tire.kilometers || 0,
          status: tire.status,
        });
      }

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
