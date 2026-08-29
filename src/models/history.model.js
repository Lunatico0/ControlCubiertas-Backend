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

export const historySchema = new mongoose.Schema({
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
  // Posición del eje donde se montó la cubierta (código de slot: E1-I, E2-DE, …). Se guarda en
  // la Asignación para poder medir el desgaste acumulado POR POSICIÓN a lo largo del tiempo.
  position: { type: String, default: null },
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

// Índices explícitos: getById, unassignVehicle, los reportes y el histórico de comprobantes
// recorren History por cubierta y en orden de fecha. Sin esto son collection scans que en un
// tenant con años de operación pegan contra el timeout de la función serverless.
historySchema.index({ tire: 1, date: 1 });
historySchema.index({ type: 1 });
historySchema.index({ vehicle: 1 });
historySchema.index({ receiptNumber: 1 });

export default mongoose.model('History', historySchema);
