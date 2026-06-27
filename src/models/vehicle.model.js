import mongoose from "mongoose";

export const vehicleSchema = new mongoose.Schema({
    brand: { type: String, required: true },
    mobile: { type: String, required: true, unique: true },
    licensePlate: { type: String, required: true, unique: true },
    type: { type: String },
    // Disposición de ejes (delantero→trasero). De acá se derivan las posiciones de
    // cubiertas (ver utils/axles.js → generatePositions). 'simple' = 2 ruedas, 'dual' = 4.
    axles: [{
        _id: false,
        type: { type: String, enum: ['simple', 'dual', 'moto'], required: true },
        label: { type: String },
    }],
    kilometers: { type: Number, default: 0 },
    tires: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Tire', default: [] }],
}, {
    timestamps: true
});

export default mongoose.model('Vehicle', vehicleSchema);
