import mongoose from 'mongoose';

// Vive en el CONTROL PLANE (DB central), no en la DB del tenant.
export const tenantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    dbName: { type: String, required: true, unique: true }, // DB de negocio del tenant
    plan: { type: String, default: 'free' },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
  },
  { timestamps: true }
);
