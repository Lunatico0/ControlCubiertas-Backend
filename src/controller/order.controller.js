import historyModel from '../models/history.model.js';

export const checkOrderExists = async (req, res) => {
  const { formattedOrder } = req.params;

  try {
    const exists = await historyModel.exists({ orderNumber: formattedOrder });
    res.json({ exists: !!exists });
  } catch (error) {
    res.status(500).json({ message: 'Error al verificar número de orden', error });
  }
};
