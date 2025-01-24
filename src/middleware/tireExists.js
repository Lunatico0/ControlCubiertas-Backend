import tireModel from "../models/tire.model.js";

export const validateTireExists = async (req, res, next) => {
    const { id } = req.params;
    const tire = await tireModel.findById(id);
    if (!tire) {
        return res.status(404).json({ message: 'Cubierta no encontrada' });
    }
    req.tire = tire;
    next();
};
