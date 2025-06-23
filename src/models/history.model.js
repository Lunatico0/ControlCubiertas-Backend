import mongoose from "mongoose";

const historyTypes = [
  'Alta',
  'Asignación',
  'Desasignación',
  'Estado',
  'Corrección-Alta',
  'Corrección-Asignación',
  'Corrección-Desasignación',
  'Corrección-Estado',
  'Corrección-Otro',
];

const historySchema = new mongoose.Schema({
  tire: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tire',
    required: true
  },
  date: { type: Date, default: Date.now },
  kmAlta: Number,
  kmBaja: Number,
  km: Number,
  status: { type: String },
  vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle' },
  type: { type: String, enum: historyTypes, required: true },
  orderNumber: { type: String },
  editedFields: [String],
  reason: String,
  editedBy: String,
  flag: { type: Boolean, default: false },
  receiptNumber: { type: String, default: "0000-00000000" },

  // 🔁 Campo nuevo para rastrear entradas corregidas
  corrects: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'History'
  }
}, {
  timestamps: true
});

export default mongoose.model('History', historySchema);
