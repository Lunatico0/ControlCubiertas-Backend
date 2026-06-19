import mongoose from 'mongoose';

// Vive en el CONTROL PLANE (DB central). El login (email+password) ocurre ANTES de saber
// qué DB de negocio usar, por eso los users son centrales: un lookup por email resuelve
// identidad + tenantId. Email único GLOBAL (suficiente para "solo tenant-admin").
export const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    role: { type: String, enum: ['tenant-admin', 'operator'], default: 'operator' },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true }
);
