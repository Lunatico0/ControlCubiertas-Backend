import mongoose from 'mongoose';
import { PLATE_FORMATS_AR } from '../../utils/plate.js';

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
    // Separador de patente para DISPLAY (la patente se guarda normalizada, sin separadores).
    // "" = sin separador; "-" muestra "EEQ541" como "EEQ-541". Configurable desde el panel admin.
    plateSeparator: { type: String, default: '' },
    // Formatos ACEPTADOS de patente, como máscaras (A = letra, 0 = dígito). Se validan sobre
    // la forma canónica, así que el separador de la máscara es irrelevante. El default es el
    // set argentino vigente; la LISTA VACÍA apaga la validación, que es la salida para una
    // flota con chapas extranjeras o históricas. Ver utils/plate.js.
    plateFormats: { type: [String], default: () => [...PLATE_FORMATS_AR] },
    // Prefijo del código interno de cubierta para DISPLAY (el code se guarda como Number
    // autoincremental). "" = sin prefijo; "TMBC-" muestra el code 12 como "TMBC-12".
    // Configurable desde el panel admin. Ver utils/tireCode en el frontend.
    tireCodePrefix: { type: String, default: '' },
    // Impresión automática del comprobante al ejecutar una acción sobre una cubierta.
    // true = comportamiento histórico (se dispara el diálogo de impresión al confirmar).
    // false = la acción se registra y el comprobante queda para reimprimir desde el historial.
    // La web NO puede saber si el operario realmente imprimió o canceló el diálogo, así que
    // la impresión NUNCA gatea la acción: es un efecto posterior, no una condición previa.
    autoPrint: { type: Boolean, default: true },

    // Estados de cubierta configurables por tenant. Rol estable (initial/stock/recap/discard)
    // que sobrevive al renombre; el orden del array define la escalera. initial y discard
    // son obligatorios (validado en company.service). Ver utils/statuses.js.
    stockStatuses: {
      type: [{ _id: false, name: String, role: { type: String, enum: ['initial', 'stock', 'recap', 'discard'], default: 'stock' }, color: { type: String } }],
      default: [
        { name: 'Nueva', role: 'initial' },
        { name: '1er Recapado', role: 'stock' },
        { name: '2do Recapado', role: 'stock' },
        { name: '3er Recapado', role: 'stock' },
        { name: 'A recapar', role: 'recap' },
        { name: 'Descartada', role: 'discard' },
      ],
    },

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
