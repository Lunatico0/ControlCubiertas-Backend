// Reserva del correlativo de comprobante.
//
// Se llama DENTRO de la mutación, después de que las validaciones pasaron. El orden importa:
// pedir el número antes es lo que dejaba huecos en el correlativo cuando la operación se
// rechazaba, y un salto en la numeración es un problema de auditoría que después nadie puede
// explicar (el QA de operario encontró los números 281 y 282 quemados por dos intentos
// rechazados de desasignar).
//
// Si el llamador ya trae un número, se respeta: el front todavía puede pedirlo por adelantado
// y esa compatibilidad se mantiene hasta que termine de migrar.
export const reservarNumeroComprobante = async (db, recibido, pointOfSale = 1) => {
  if (recibido) return recibido;

  const counter = await db.ReceiptCounter.findOneAndUpdate(
    { pointOfSale },
    { $inc: { currentNumber: 1 } },
    { new: true, upsert: true }
  );

  return `${String(pointOfSale).padStart(4, '0')}-${String(counter.currentNumber).padStart(8, '0')}`;
};
