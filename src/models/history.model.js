import mongoose from "mongoose";

const historyTypes = [
  'alta',
  'asignacion',
  'desasignacion',
  'estado',
  'correccion-alta',
  'correccion-asignacion',
  'correccion-desasignacion',
  'correccion-estado',
  'correccion-otro',
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
  type: {
    type: String,
    enum: historyTypes,
    required: true
  },
  orderNumber: { type: String },
  editedFields: [String],
  reason: String,
  editedBy: String,
  flag: { type: Boolean, default: false },

  // 🔁 Campo nuevo para rastrear entradas corregidas
  corrects: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'History'
  }
}, {
  timestamps: true
});

export default mongoose.model('History', historySchema);
