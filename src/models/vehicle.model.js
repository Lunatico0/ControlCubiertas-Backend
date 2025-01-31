import mongoose from "mongoose";

const vehicleSchema = new mongoose.Schema({
    brand: { type: String, required: true },
    mobile: { type: String, required: true, unique: true },
    licensePlate: { type: String, required: true, unique: true },
    type: { type: String },
    tires: { type: [mongoose.Schema.Types.ObjectId], ref: 'Tire', default: [] },
}, {
    timestamps: true
});

export default mongoose.model('Vehicle', vehicleSchema);
