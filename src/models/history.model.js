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

// Autor del movimiento, como SNAPSHOT al momento de escribir: si el usuario cambia de nombre o
// se borra, la entrada sigue diciendo quién la hizo. `id: false` apaga el virtual `id` de
// Mongoose, que si no taparía el campo `id` propio del subdocumento. Las entradas viejas no lo
// tienen (quedan "Sin registro"): el campo NO tiene default a propósito, para no inventar uno.
const historyUserSchema = new mongoose.Schema({
  id: { type: String },
  name: { type: String },
}, { _id: false, id: false });

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
  // Vehículo del que SALIÓ la cubierta, en la Desasignación. `vehicle` sigue en null en esa
  // entrada (lo leen recalculateTireState, los reportes y vehicleCleanup con esa semántica);
  // este campo es el que permite decir en el comprobante de qué camión se bajó.
  fromVehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle' },
  type: { type: String, enum: historyTypes, required: true },
  orderNumber: { type: String },
  editedFields: [String],
  reason: String,
  // Legacy: solo lo lee receipts.service. El autor nuevo vive en `user`.
  editedBy: String,
  user: { type: historyUserSchema, default: undefined },
  flag: { type: Boolean, default: false },
  // Cuándo se corrigió o deshizo esta entrada. La entrada corregida CONSERVA su `type`: qué
  // entrada la corrige se sabe por el `corrects` de la otra, no por reetiquetarla.
  correctedAt: { type: Date },
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
