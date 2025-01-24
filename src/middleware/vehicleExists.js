import vehicleModel from "../models/vehicle.model.js";

export const validateVehicleExists = async (req, res, next) => {
    const { id } = req.params;
    const vehicle = await vehicleModel.findById(id);
    if (!vehicle) {
        return res.status(404).json({ message: 'Vehículo no encontrado' });
    }
    req.vehicle = vehicle;
    next();
};
