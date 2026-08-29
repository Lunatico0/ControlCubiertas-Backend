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

// Índices explícitos: getAll filtra por status y los reportes buscan las cubiertas montadas
// por vehículo. `code` ya trae el unique implícito.
tireSchema.index({ vehicle: 1 });
tireSchema.index({ status: 1 });

export default mongoose.model('Tire', tireSchema);
