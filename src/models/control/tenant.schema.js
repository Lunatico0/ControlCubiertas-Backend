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
  },
  { timestamps: true }
);
