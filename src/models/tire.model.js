import mongoose from "mongoose";
const historyTypes = [
  'alta',
  'asignacion',
  'desasignacion',
  'estado',
  'correccion-alta',
  'correccion-asignacion',
  'correccion-desasignacion',
  'correccion-estado'
];

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
        enum: historyTypes,
        required: true
      },
      orderNumber: { type: String },
      editedFields: [String],
      reason: String,
      editedBy: String,
      flag: { type: Boolean, default: false }
    }
  ],
}, {
  timestamps: true
});

export default mongoose.model('Tire', tireSchema);
