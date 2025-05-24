import mongoose from "mongoose";

const receiptCounterSchema = new mongoose.Schema({
  pointOfSale: {
    type: Number,
    required: true,
    default: 1
  },
  currentNumber: {
    type: Number,
    required: true,
    default: 0
  }
});

export default mongoose.model("ReceiptCounter", receiptCounterSchema);
