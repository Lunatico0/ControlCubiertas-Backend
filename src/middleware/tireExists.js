import { asyncHandler } from '../utils/asyncHandler.js';
import { httpError } from '../utils/httpError.js';

// asyncHandler NO es opcional acá: en Express 4 una promesa rechazada dentro de un middleware
// async no llega al handler de errores, queda como unhandled rejection y la request NUNCA
// responde. Un `:id` malformado (`findById('abc')` → CastError) alcanzaba para colgar la
// conexión hasta el timeout del cliente, y en serverless para quemar la invocación entera.
export const validateTireExists = asyncHandler(async (req, res, next) => {
    const { id } = req.params;
    // Un id que ni siquiera tiene forma de ObjectId es input inválido, no "no encontrado".
    if (!req.db.Tire.base.Types.ObjectId.isValid(id)) {
        throw httpError('Identificador inválido', 400, 'id');
    }
    const tire = await req.db.Tire.findById(id);
    if (!tire) {
        throw httpError('Cubierta no encontrada', 404);
    }
    req.tire = tire;
    next();
});
