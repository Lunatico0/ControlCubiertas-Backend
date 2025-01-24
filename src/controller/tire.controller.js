import tireModel from "../models/tire.model.js";
import vehicleModel from "../models/vehicle.model.js";

class TireController {
  async getAll(req, res) {
    try {
      const tires = await tireModel.find().populate('Vehicle');
      res.json(tires);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }

  async getById(req, res) {
    try {
      const { id } = req.params;
      const tire = await tireModel.findById(id).populate('Vehicle');
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
      const { vehicle, ...updateData } = req.body;

      const tire = await tireModel.findById(id);
      if (!tire) return res.status(404).json({ message: 'Tire not found' });

      if (vehicle && String(tire.vehicle) !== vehicle) {
        const newVehicle = await vehicleModel.findById(vehicle);

        if (!newVehicle) {
          return res.status(404).json({ message: 'El nuevo vehículo no existe' });
        }

        // Quitar la cubierta del vehículo anterior
        if (tire.vehicle) {
          await vehicleModel.findByIdAndUpdate(tire.vehicle, { $pull: { tires: id } });
        }

        // Agregar la cubierta al nuevo vehículo
        await vehicleModel.findByIdAndUpdate(vehicle, { $addToSet: { tires: id } });
        tire.vehicle = vehicle;
      }

      Object.assign(tire, updateData);
      await tire.save();

      res.json(tire);
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  }
}

export default new TireController();