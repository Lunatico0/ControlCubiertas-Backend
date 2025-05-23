import mongoose from "mongoose";

const tireSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ['Nueva', '1er Recapado', '2do Recapado', '3er Recapado', 'A recapar', 'Descartada'],
    required: true
  },
  code: { type: Number, required: true, unique: true },
  brand: { type: String, required: true },
  pattern: { type: String, required: true },
  serialNumber: { type: String, required: true },
  kilometers: { type: Number, default: 0 },
  vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle' },

  history: [
    {
      date: { type: Date, default: Date.now },
      kmAlta: Number,
      kmBaja: Number,
      km: Number,
      status: { type: String },
      vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle' },
      type: {
        type: String,
        enum: ['asignacion', 'desasignacion', 'estado', 'correccion'],
        required: true
      },
      orderNumber: { type: String },
      editedFields: [String], // solo en correcciones
      reason: String,         // solo en correcciones
      editedBy: String,       // solo en correcciones
      flag: { type: Boolean, default: false }
    }
  ],
}, {
  timestamps: true
});

export default mongoose.model('Tire', tireSchema);
