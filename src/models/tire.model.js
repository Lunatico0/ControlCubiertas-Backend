import mongoose from "mongoose";

const tireSchema = new mongoose.Schema({
  status: { type: String, enum: ['Nueva', '1er Recapado', '2do Recapado', '3er Recapado', 'Descartada'], required: true },
  code: { type: Number, required: true , unique: true },
  brand: { type: String, required: true },
  size: { type: String, required: true },
  pattern: { type: String, required: true },
  kilometers: { type: Number, default: 0, required: true },
  vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle' }
},{
  timestamps: true
});

export default mongoose.model('Tire', tireSchema);
