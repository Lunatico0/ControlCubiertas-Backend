import mongoose from "mongoose";

export const tireSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ['Nueva', '1er Recapado', '2do Recapado', '3er Recapado', 'A recapar', 'Descartada'],
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
