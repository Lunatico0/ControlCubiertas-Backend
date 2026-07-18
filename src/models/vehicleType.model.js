import mongoose from "mongoose";

// Tipos de vehículo CUSTOM guardados por el tenant (data-plane). Los presets (Camión 4×2,
// 6×4, Semi, etc.) viven en el front como constante; acá solo se persisten los que el
// usuario define. `axles` = layout de ejes (delantero→trasero); el "tipo" se deriva de ese
// layout. El nombre es único por tenant (se valida en el controller — no dependemos del
// índice unique, que en mongodb-memory-server puede no estar construido).
export const vehicleTypeSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    axles: [{ type: String, enum: ['simple', 'dual', 'moto'] }],
}, {
    timestamps: true
});

export default mongoose.model('VehicleType', vehicleTypeSchema);
