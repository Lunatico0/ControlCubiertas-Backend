import mongoose from 'mongoose';
import { config } from 'dotenv';

config();
const mongoUrl = process.env.MONGO_URI;

mongoose.connect(mongoUrl, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('Conexión a MongoDB exitosa');
}).catch((error) => {
    console.error('Error al conectar a MongoDB:', error);
});


mongoose.set("strictPopulate", false);