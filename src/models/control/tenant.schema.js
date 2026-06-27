import mongoose from 'mongoose';

// Vive en el CONTROL PLANE (DB central), no en la DB del tenant.
export const tenantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    dbName: { type: String, required: true, unique: true }, // DB de negocio del tenant
    plan: { type: String, default: 'free' },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },

    // Datos de la empresa (editables por el tenant-admin desde el panel)
    cuit: { type: String },
    phone: { type: String },
    address: { type: String },

    // Preferencias operativas (aplican a toda la operación del tenant)
    receiptPrefix: { type: String, default: '0001' },
    receiptFooter: { type: String },
    stockStatuses: { type: [String], default: ['Nueva', '1er Recapado', '2do Recapado'] },

    // Diseño del comprobante impreso (editor de comprobante). Aplica a TODA la operación
    // del tenant (no es por device). Lo edita el tenant-admin. El logo se guarda como
    // dataURL — a futuro conviene moverlo a un storage de assets si crece.
    receiptDesign: {
      logo: { type: String, default: null },
      logoPos: { type: String, enum: ['left', 'center', 'right'], default: 'left' },
      logoSize: { type: String, enum: ['S', 'M', 'L'], default: 'M' },
      showHeader: { type: Boolean, default: true },
      accent: { type: String, default: '#1F7A43' },
      font: { type: String, default: "'Space Grotesk', sans-serif" },
      textSize: { type: String, enum: ['S', 'M', 'L'], default: 'M' },
      align: { type: String, enum: ['left', 'center'], default: 'left' },
      duplicado: { type: Boolean, default: true },
      sections: {
        type: [{ _id: false, key: String, label: String, on: Boolean }],
        default: [
          { key: 'cubierta', label: 'Datos de la cubierta', on: true },
          { key: 'vehiculo', label: 'Datos del vehículo', on: true },
          { key: 'kilometraje', label: 'Kilometraje', on: true },
          { key: 'orden', label: 'N° de orden', on: true },
        ],
      },
    },
  },
  { timestamps: true }
);
