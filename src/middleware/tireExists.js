export const validateTireExists = async (req, res, next) => {
    const { id } = req.params;
    const tire = await req.db.Tire.findById(id);
    if (!tire) {
        return res.status(404).json({ message: 'Cubierta no encontrada' });
    }
    req.tire = tire;
    next();
};
