import mongoose from "mongoose";

export const tireSchema = new mongoose.Schema({
  // Sin enum fijo: los estados válidos son configurables por tenant (tenant.stockStatuses).
  // La pertenencia se valida dinámicamente en la capa de servicio (ver tire.controller).
  status: {
    type: String,
    required: true
  },
  code: { type: Number, required: true, unique: true },
  brand: { type: String, required: true },
  pattern: { type: String, required: true },
  size: { type: String, required: true },
  serialNumber: { type: String, required: true },
  kilometers: { type: Number, default: 0 },
  vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle' },
  // Posición en el eje cuando está montada (código de slot: E1-I, E2-DE, …). null en depósito.
  position: { type: String, default: null }
}, {
  timestamps: true
});

export default mongoose.model('Tire', tireSchema);
