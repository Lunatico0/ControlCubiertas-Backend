import { toCorrectionType, recalculateTireState, updateTireFromState, addHistoryEntry, idOf } from '../utils/utils.js';
import { nameByRole, roleOf } from '../utils/statuses.js';
import { reconcileTireVehicleLinks } from '../utils/vehicleTires.js';
import { generatePositions } from '../utils/axles.js';
import { httpError } from '../utils/httpError.js';
import { reservarNumeroComprobante } from '../utils/receipt.js';

// Los modelos llegan por `db` (inyectado por el middleware attachDb) en vez de importarse
// globalmente. Esto habilita DB-per-tenant: el mismo service opera sobre la conexión del
// tenant que resuelva el middleware. La conexión NUNCA se guarda como estado del singleton.
class TireService {
  async getAll(db, statuses = []) {
    const tires = await db.Tire.find().populate('vehicle').lean();
    // Un tenant recién creado NO tiene cubiertas: eso es un estado válido (lista vacía),
    // no un error. Devolver [] evita el 500 en la primera pantalla de un cliente nuevo.
    if (!tires || tires.length === 0) {
      return [];
    }

    // Escalera de recapado: nombre → nivel (Nueva=0, 1er=1, 2do=2, ...). Solo cuentan los
    // roles de escalera (initial/stock); recap y discard no son un recapado en sí.
    const levelOf = {};
    let idx = 0;
    for (const s of statuses) {
      if (s?.role === 'initial' || s?.role === 'stock') levelOf[s.name] = idx++;
    }

    // Para las cubiertas fuera de la escalera (A recapar / Descartada) el status actual no
    // dice con qué recapado salieron: se toma el máximo nivel de escalera visto en su historial.
    const ladderNames = Object.keys(levelOf);
    const maxLevel = {};
    if (ladderNames.length) {
      const entries = await db.History
        .find({ status: { $in: ladderNames } })
        .select('tire status')
        .lean();
      for (const h of entries) {
        const lvl = levelOf[h.status];
        const key = String(h.tire);
        if (lvl > (maxLevel[key] ?? -1)) maxLevel[key] = lvl;
      }
    }

    return tires.map((t) => {
      const current = levelOf[t.status]; // definido si el status actual está en la escalera
      const recapLevel = current ?? maxLevel[String(t._id)] ?? 0;
      return { ...t, recapLevel };
    });
  }

  async getById(db, id) {
    const tire = await db.Tire.findById(id).populate('vehicle');
    if (!tire) throw httpError('Cubierta no encontrada', 404);

    const history = await db.History
      .find({ tire: id })
      .populate('vehicle')
      .populate('corrects')
      .sort({ date: 1 });

    return { ...tire.toObject(), history };
  }

  async getDocById(db, id) {
    const tire = await db.Tire.findById(id).populate('vehicle');
    if (!tire) throw httpError('Cubierta no encontrada', 404);
    return tire;
  }

  async findVehicleById(db, id) {
    const vehicle = await db.Vehicle.findById(id);
    if (!vehicle) throw httpError('Vehículo no encontrado', 404);
    return vehicle;
  }

  async createTire(db, data) {
    const {
      status,
      code,
      brand,
      pattern,
      serialNumber,
      size,
      kilometers = 0,
      vehicle,
      createdAt,
      orderNumber,
      receiptNumber
    } = data;

    if (!serialNumber) throw httpError('El número de serie (serialNumber) es requerido.', 400, 'serialNumber');

    const entryDate = createdAt ? new Date(createdAt) : new Date();

    const newTire = new db.Tire({
      status,
      code,
      brand,
      pattern,
      size,
      serialNumber,
      kilometers,
      vehicle: vehicle || null,
      createdAt: entryDate
    });

    await newTire.save();

    // El número se reserva recién ACÁ, con la cubierta ya guardada: un alta rechazada no deja
    // un hueco en el correlativo.
    const numero = await reservarNumeroComprobante(db, receiptNumber);

    await db.History.create({
      tire: newTire._id,
      vehicle: vehicle || null,
      km: kilometers,
      status,
      date: entryDate,
      type: 'Alta',
      orderNumber: orderNumber || null,
      receiptNumber: numero
    });

    if (vehicle) {
      await db.Vehicle.findByIdAndUpdate(vehicle, {
        $addToSet: { tires: newTire._id }
      });
    }
    newTire.receiptNumber = numero; // no se persiste: viaja en la respuesta para imprimir
    return newTire;
  }

  async assignVehicle(db, tireId, vehicleId, kmAlta, orderNumber, receiptNumber, position) {
    const tire = await this.getDocById(db, tireId);
    const vehicle = await this.findVehicleById(db, vehicleId);

    if (tire.vehicle) throw httpError('La cubierta ya está asignada a un vehículo', 409);

    // Posición opcional: si viene, debe existir en los ejes del vehículo y estar libre.
    if (position) {
      const exists = generatePositions(vehicle.axles).some((p) => p.code === position);
      if (!exists) throw httpError(`La posición ${position} no existe en este vehículo`, 400);
      const occupied = await db.Tire.findOne({ vehicle: vehicleId, position, _id: { $ne: tire._id } });
      if (occupied) throw httpError(`La posición ${position} ya está ocupada en este vehículo`, 409);
    }

    tire.vehicle = vehicleId;
    tire.position = position || null;
    vehicle.tires.push(tire._id);

    // Después de los guards de posición ocupada / cubierta ya asignada: si alguno rebota, el
    // correlativo queda intacto.
    const numero = await reservarNumeroComprobante(db, receiptNumber);

    await addHistoryEntry(db.History, tire._id, {
      type: 'Asignación',
      vehicle: vehicleId,
      status: tire.status,
      position: position || null,
      kmAlta,
      orderNumber: orderNumber || null,
      receiptNumber: numero
    });

    await vehicle.save();
    await tire.save();
    await tire.populate('vehicle');
    tire.receiptNumber = numero; // no se persiste: viaja en la respuesta para imprimir
    return tire;
  }

  async unassignVehicle(db, tireId, kmBaja, orderNumber, receiptNumber) {
    const tire = await this.getDocById(db, tireId);
    const vehicle = await this.findVehicleById(db, tire.vehicle);

    const history = await db.History
      .find({ tire: tireId })
      .sort({ date: 1 });

    const currentState = recalculateTireState(history);
    const kmAlta = currentState.lastAssignmentKm;
    const kmRecorridos = kmBaja - kmAlta;

    // t141: el mensaje trae el VALOR concreto contra el que se compara. Antes decía sólo que
    // no podía ser menor "que el de alta", y el operario tenía que cerrar el modal, ir al
    // historial, anotar el número y volver, en la acción más frecuente después de asignar.
    // El dato ya está calculado acá arriba: ponerlo en el mensaje no cuesta una query.
    if (kmRecorridos < 0) {
      throw httpError(
        `El odómetro al desmontar (${kmBaja.toLocaleString('es-AR')} km) no puede ser menor que el odómetro al montar (${kmAlta.toLocaleString('es-AR')} km).`,
        400,
        'kmBaja',
      );
    }

    // Recién acá, pasado el control de kilometraje: es justo el rechazo que quemaba números.
    const numero = await reservarNumeroComprobante(db, receiptNumber);

    tire.vehicle = null;
    tire.position = null; // al bajar del vehículo, la cubierta deja su posición libre
    tire.kilometers += kmRecorridos;

    await addHistoryEntry(db.History, tire._id, {
      type: 'Desasignación',
      status: tire.status,
      kmBaja,
      km: kmRecorridos,
      kmAlta,
      vehicle: null,
      orderNumber: orderNumber || null,
      receiptNumber: numero
    });

    const updatedHistory = await db.History.find({ tire: tireId }).sort({ date: 1 });
    const finalState = recalculateTireState(updatedHistory);
    updateTireFromState(tire, finalState);

    vehicle.tires = vehicle.tires.filter(tid => tid.toString() !== tireId);
    await vehicle.save();
    await tire.save();

    return {
      tire,
      kmAlta,
      kmBaja,
      kmRecorridos,
      receiptNumber: numero
    };
  }

  async updateTireStatus(db, tireId, status, orderNumber, receiptNumber, statuses = []) {
    const tire = await this.getDocById(db, tireId);
    const previousStatus = tire.status;

    // S4: una cubierta montada no puede irse a recapar ni darse de baja: quedaría ocupando una
    // posición del camión sin estar ahí. Por ROL del tenant, nunca por nombre de estado.
    // Va ANTES de reservar el número, para que el rechazo no queme un comprobante.
    const rolDestino = roleOf(statuses, status);
    if (tire.vehicle && (rolDestino === 'recap' || rolDestino === 'discard')) {
      const para = rolDestino === 'recap' ? 'enviarla a recapar' : 'darla de baja';
      throw httpError(`La cubierta está montada en un vehículo. Desmontala primero para ${para}.`, 409, 'status');
    }

    tire.status = status;

    const numero = await reservarNumeroComprobante(db, receiptNumber);

    await addHistoryEntry(db.History, tire._id, {
      type: 'Estado',
      vehicle: tire.vehicle,
      status,
      orderNumber: orderNumber || null,
      receiptNumber: numero
    });

    await tire.save();
    return { tire, previousStatus, receiptNumber: numero };
  }

  async correctData(db, tireId, data) {
    const tire = await this.getDocById(db, tireId);
    const allowedFields = ['serialNumber', 'code', 'size', 'brand', 'pattern'];
    // La ruta todavía no tiene schema Zod: sin este guard, un body sin `form` tiraba un
    // TypeError de destructuring que salía como 500 con el detalle interno adentro.
    if (!data || typeof data.form !== 'object' || data.form === null) {
      throw httpError('Falta el bloque "form" con los datos de la corrección', 400, 'form');
    }
    const { reason, date, orderNumber } = data.form;

    const previousData = {};
    const editedFields = [];
    const fieldChanges = {};

    const normalize = (value) => {
      if (typeof value === 'string') return value.trim();
      if (typeof value === 'number') return String(value);
      return value ?? '';
    };

    for (const field of allowedFields) {
      const current = normalize(tire[field]);
      const incoming = normalize(data.form[field]);

      if (incoming && incoming !== current) {
        previousData[field] = tire[field];
        fieldChanges[field] = {
          before: tire[field],
          after: data.form[field]
        };
        tire[field] = data.form[field];
        editedFields.push(field);
      }
    }

    if (editedFields.length === 0) {
      throw httpError('No se detectaron cambios válidos para corregir.', 400);
    }

    const parsedDate = date && !isNaN(new Date(date)) ? new Date(date) : new Date();

    // S3: la cubierta se guarda ANTES de reservar el número y de escribir la entrada. Si el
    // guardado rebota (índice único de `code`, una carrera que el pre-check del controller no
    // ve), no queda número quemado ni una corrección que nunca ocurrió.
    await tire.save();

    // Después del guard de "no se detectaron cambios": una corrección vacía no gasta número.
    const numero = await reservarNumeroComprobante(db, data.form.receiptNumber);

    await addHistoryEntry(db.History, tire._id, {
      type: 'Corrección-Alta',
      date: parsedDate,
      km: tire.kilometers || 0,
      vehicle: tire.vehicle || null,
      status: tire.status,
      editedFields,
      reason,
      orderNumber: orderNumber || null,
      flag: true,
      receiptNumber: numero
    });

    await tire.populate('vehicle');

    return {
      previousData,
      editedFields,
      fieldChanges,
      tire,
      receiptNumber: numero
    };
  }

  async correctHistoryEntry(db, tireId, historyId, updates) {
    const tire = await this.getDocById(db, tireId);
    const original = await db.History.findById(historyId).populate('vehicle').populate('corrects');
    // El guard va ACÁ y no veinte líneas más abajo: ahí ya se había leído original.orderNumber
    // (TypeError y 500 en vez de este 404) y, peor, ya se había reservado un número de
    // comprobante que quedaba quemado por una corrección que nunca se pudo intentar.
    if (!original) throw httpError('Entrada de historial no encontrada', 404);

    const history = await db.History.find({ tire: tire._id }).sort({ date: 1 });
    const originalOrder = original.orderNumber;
    const correctionOrder = updates.form.orderNumber;

    const reasonOriginal = `Corregido en la orden N°${correctionOrder}`;
    const reasonCorrection = `Corrección de Orden N°${originalOrder}`;
    const userExtra = updates.form.reason?.trim() || '';


    const compareValues = (a, b) => {
      if ((a == null || a === '') && (b == null || b === '')) return false;
      return a?.toString() !== b?.toString();
    };

    const editedFields = [];
    const fieldChanges = {};

    // S6: `original.vehicle` viene POPULADO. Compararlo con toString() contra el id del form
    // daba siempre "cambió" (el toString de un documento no es su id). Se compara por id.
    const valorOriginal = (field) => (field === 'vehicle' ? idOf(original.vehicle) : original[field]);

    ['kmAlta', 'kmBaja', 'status', 'vehicle'].forEach(field => {
      if (Object.hasOwn(updates.form, field)) {
        const newVal = updates.form[field];
        const oldVal = valorOriginal(field);

        if (compareValues(oldVal, newVal)) {
          editedFields.push(field);
          fieldChanges[field] = {
            before: oldVal,
            after: newVal
          };
        }
      }
    });

    if (editedFields.length === 0) {
      throw httpError('No se detectaron cambios para corregir.', 400);
    }

    // N2: el número se reserva recién acá, pasado el guard de "sin cambios". Antes se pedía
    // arriba de todo y una corrección vacía quemaba un comprobante.
    const receiptNumber = await reservarNumeroComprobante(db, updates.form.receiptNumber);

    const originalType = original.type;
    const vehiculoEditado = editedFields.includes('vehicle');

    // S6: la original CONSERVA su tipo. Solo se marca (flag, motivo, cuándo). Que fue
    // corregida se sabe por el `corrects` de la entrada nueva; reetiquetarla "Corrección-*"
    // borraba qué había sido el movimiento y le sacaba al timeline el Deshacer.
    original.flag = true;
    original.reason = reasonOriginal;
    original.correctedAt = new Date();

    await original.save();

    // El clon parte de la original sin sus refs populadas ni su metadata: la entrada nueva
    // tiene sus propias fechas, su propio autor y su propia marca de corrección.
    const clone = original.toObject({ depopulate: true });
    delete clone._id;
    delete clone.__v;
    delete clone.createdAt;
    delete clone.updatedAt;
    delete clone.correctedAt;
    delete clone.user;

    const reasonFinal = userExtra && userExtra !== reasonCorrection
      ? `${reasonCorrection} ${userExtra}`
      : reasonCorrection;

    // km recalculado para las correcciones de desasignación (ver abajo).
    let kmFinal = undefined;

    // Para Correcciónes de Desasignación, calcular correctamente los km
    if (original.type === 'Desasignación' || original.type === 'Corrección-Desasignación') {
      // Obtener kmAlta y kmBaja finales
      const kmAltaFinal = updates.form.kmAlta ?? original.kmAlta ?? 0;
      const kmBajaFinal = updates.form.kmBaja ?? original.kmBaja ?? 0;

      // Si no tenemos kmAlta en la entrada original, buscar la última asignación
      let kmAltaToUse = kmAltaFinal;
      if (!kmAltaFinal && !original.kmAlta) {
        // Buscar la última asignación antes de esta entrada
        const lastAssignment = [...history]
          .reverse()
          .find(h =>
            h.type === 'Asignación' &&
            new Date(h.date) < new Date(original.date) &&
            h.kmAlta != null
          );
        kmAltaToUse = lastAssignment?.kmAlta ?? 0;
      }

      // Calcular los kilómetros recorridos
      kmFinal = kmBajaFinal - kmAltaToUse;
    }

    const newEntry = {
      ...clone,
      ...updates.form,
      tire: tireId,
      type: toCorrectionType(originalType),
      flag: true,
      editedFields,
      date: new Date(),
      reason: reasonFinal,
      // Si el form no corrige el vehículo, la corrección conserva el de la original. Antes
      // caía a null y corregir solo el km de una asignación DESMONTABA la cubierta.
      vehicle: vehiculoEditado ? (updates.form.vehicle || null) : idOf(original.vehicle),
      // N6: la posición es del vehículo viejo; en el nuevo no significa nada.
      position: vehiculoEditado ? null : (clone.position ?? null),
      corrects: original._id,
      km: kmFinal, // usa el valor calculado arriba
      receiptNumber
    };

    await db.History.create(newEntry);
    const updatedHistory = await db.History.find({ tire: tireId }).sort({ date: 1 });
    const finalState = recalculateTireState(updatedHistory);
    // Si el vehículo efectivo cambió, updateTireFromState limpia la posición (N6).
    updateTireFromState(tire, finalState); // Aplicar estado final

    await tire.save();
    // Corregir un movimiento puede cambiar de vehículo (o sacarla de todos): alinear el otro lado.
    await reconcileTireVehicleLinks(db, tire);
    await tire.populate('vehicle');

    return {
      editedFields,
      fieldChanges,
      tire
    };
  };

  async undoHistoryEntry(db, tireId, historyId, formData, statuses = []) {
    const { orderNumber } = formData;

    const tire = await this.getDocById(db, tireId);
    const history = await db.History.find({ tire: tire._id }).sort({ date: 1 });
    const original = await db.History.findById(historyId).populate('vehicle').populate('corrects');
    if (!original) throw httpError('Entrada de historial no encontrada', 404);

    // Definir razones
    const reasonOriginal = `Deshecho en la orden N°${orderNumber}`;
    const reasonUndo = `Deshacer entrada N°${original.orderNumber}`;
    const userExtra = formData.reason?.trim() || '';
    const reasonFinal = userExtra && userExtra !== reasonUndo
      ? `${reasonUndo} ${userExtra}`
      : reasonUndo;

    const originalType = original.type;

    // N1: la reversión se RESUELVE entera antes de escribir nada. Cada rechazo posible (tipo
    // no soportado, alta, sin asignación previa, posición ocupada) sale de acá, antes de
    // reservar el número y antes de marcar la original. Antes la original quedaba marcada
    // "Deshecho en la orden ..." y el número quemado aunque el deshacer rebotara.
    let reversion;
    switch (originalType) {
      case 'Asignación':
      case 'Corrección-Asignación':
        // Deshacer asignación = desasignar cubierta
        reversion = this.handleUndoAssignment(tire, original, orderNumber, reasonFinal);
        break;

      case 'Desasignación':
      case 'Corrección-Desasignación':
        // Deshacer Desasignación = reasignar al vehículo y la posición anteriores
        reversion = await this.handleUndoUnassignment(db, tire, original, history, orderNumber, reasonFinal);
        break;

      case 'Estado':
      case 'Corrección-Estado':
        // Deshacer cambio de estado = volver al estado anterior
        reversion = this.handleUndoStatusChange(tire, original, history, orderNumber, reasonFinal, statuses, originalType);
        break;

      case 'Alta':
      case 'Corrección-Alta':
        // Deshacer alta = marcar como eliminada (no implementado por seguridad)
        throw httpError('No se puede deshacer el alta de una cubierta: para eso hay que descartarla.', 409);

      default:
        throw httpError(`Tipo de entrada no soportado para deshacer: ${originalType}`, 400);
    }

    // Recién acá, con la reversión ya validada.
    const receiptNumber = await reservarNumeroComprobante(db, formData.receiptNumber);

    // S7: la original CONSERVA su tipo (igual que al corregir). Queda marcada como deshecha;
    // quién la deshizo se sabe por el `corrects` de la entrada nueva.
    original.flag = true;
    original.editedFields = ['Deshacer entrada'];
    original.correctedAt = new Date();
    original.reason = reasonOriginal;
    await original.save();

    const newEntry = { ...reversion.newEntry, receiptNumber };
    await db.History.create(newEntry);

    // Recalcular estado final. Sin vehículo (o con otro) la posición se limpia (S7).
    const updatedHistory = await db.History.find({ tire: tireId }).sort({ date: 1 });
    const finalState = recalculateTireState(updatedHistory);
    updateTireFromState(tire, finalState);

    // N5: de vuelta en el vehículo de la asignación previa, recupera su posición.
    if (reversion.position && idOf(tire.vehicle) === idOf(newEntry.vehicle)) {
      tire.position = reversion.position;
    }

    await tire.save();
    // `tire.vehicle` acaba de recalcularse desde el historial: alinear el otro lado.
    await reconcileTireVehicleLinks(db, tire);
    await tire.populate('vehicle');

    return {
      tire,
      correctedEntryId: historyId,
      newEntry,
      revertedTo: reversion.revertedTo,
      receiptNumber
    };
  }

  // Los handlers de reversión NO escriben: arman la entrada nueva (sin número de comprobante)
  // y validan. undoHistoryEntry escribe recién cuando todos pasaron (N1).
  handleUndoAssignment(tire, original, correctionOrder, reason) {
    // Entrada de Desasignación sin kmAlta ni kmBaja
    const newEntry = {
      tire: tire._id,
      type: 'Desasignación',
      date: new Date(),
      orderNumber: correctionOrder,
      reason: reason,
      flag: true,
      editedFields: ['Deshacer asignación'],
      vehicle: null, // Desasignar
      // No incluimos kmAlta ni kmBaja para que queden como null/undefined
      km: 0,
      status: tire.status,
      corrects: original._id,
    };

    return {
      newEntry,
      revertedTo: 'Cubierta desasignada'
    };
  }

  async handleUndoUnassignment(db, tire, original, history, correctionOrder, reason) {
    // La asignación previa es la última EFECTIVA antes de la desasignación: la que ninguna
    // otra entrada corrige. Mismo criterio que recalculateTireState. Filtrar por `flag`
    // salteaba las correcciones y los deshaceres (que también llevan flag) y reasignaba a un
    // vehículo y una posición que ya no eran los vigentes.
    const corregidas = new Set(history.filter((h) => h.corrects).map((h) => idOf(h.corrects)));
    const lastAssignment = [...history]
      .reverse()
      .find(entry =>
        (entry.type === 'Asignación' || entry.type === 'Corrección-Asignación') &&
        new Date(entry.date) < new Date(original.date) &&
        !corregidas.has(String(entry._id))
      );

    if (!lastAssignment) {
      throw httpError('No se encontró una asignación anterior para revertir', 409);
    }

    const vehicleId = idOf(lastAssignment.vehicle);

    // N5: la cubierta vuelve a la posición que tenía. Si el vehículo ya no tiene esa posición
    // (se reconfiguraron los ejes) vuelve sin posición, como antes. Si otra cubierta la ocupa,
    // se rechaza: montar dos cubiertas en el mismo lugar es justo lo que había que evitar.
    let position = lastAssignment.position || null;
    if (position) {
      const vehicle = await db.Vehicle.findById(vehicleId).select('axles');
      const existe = vehicle && generatePositions(vehicle.axles).some((p) => p.code === position);
      if (!existe) {
        position = null;
      } else {
        const ocupada = await db.Tire.findOne({ vehicle: vehicleId, position, _id: { $ne: tire._id } }).select('code');
        if (ocupada) {
          throw httpError(
            `La posición ${position} ya está ocupada por la cubierta ${ocupada.code}. Desmontala primero para deshacer esta desasignación.`,
            409,
          );
        }
      }
    }

    // Obtener el kmAlta correcto de la última asignación
    const correctKmAlta = lastAssignment.kmAlta || 0;

    const newEntry = {
      tire: tire._id,
      type: 'Asignación',
      date: new Date(),
      orderNumber: correctionOrder,
      reason: reason,
      flag: true,
      editedFields: ['Deshacer Desasignación'],
      vehicle: lastAssignment.vehicle,
      position,
      kmAlta: correctKmAlta, // Usar el kmAlta de la asignación original
      status: tire.status,
      corrects: original._id,
    };

    return {
      newEntry,
      position,
      revertedTo: `Cubierta reasignada al vehículo ${vehicleId} con kmAlta=${correctKmAlta}`
    };
  }

  handleUndoStatusChange(tire, original, history, correctionOrder, reason, statuses = [], originalType = original.type) {
    // Buscar el estado anterior
    const previousStatusEntry = [...history]
      .reverse()
      .find(entry =>
        (entry.type === 'Estado' || entry.type === 'Alta') &&
        new Date(entry.date) < new Date(original.date) &&
        !entry.flag &&
        entry.status
      );

    // El estado de reversión sale del ROL, nunca de un literal: el tenant puede haber
    // renombrado su estado inicial a "0 km" y "Nueva" no existiría en su escalera.
    const estadoInicial = nameByRole(statuses, 'initial') || 'Nueva';
    let revertedStatus = estadoInicial;

    if (previousStatusEntry) {
      revertedStatus = previousStatusEntry.status;
    } else if (originalType === 'Corrección-Estado' && original.corrects) {
      // Si es una corrección, buscar la entrada original. `corrects` viene populado: se
      // compara por id (el toString de un documento no es su id).
      const originalStatusChange = history.find(h => String(h._id) === idOf(original.corrects));
      if (originalStatusChange) {
        // Buscar el estado anterior a la entrada original
        const evenEarlierStatus = [...history]
          .reverse()
          .find(entry =>
            (entry.type === 'Estado' || entry.type === 'Alta') &&
            new Date(entry.date) < new Date(originalStatusChange.date) &&
            !entry.flag &&
            entry.status
          );
        revertedStatus = evenEarlierStatus ? evenEarlierStatus.status : estadoInicial;
      }
    }

    // Entrada de cambio de estado
    const newEntry = {
      tire: tire._id,
      type: 'Estado',
      date: new Date(),
      orderNumber: correctionOrder,
      reason: reason,
      flag: true,
      editedFields: ['Deshacer cambio de estado'],
      status: revertedStatus,
      vehicle: tire.vehicle,
      corrects: original._id,
    };

    return {
      newEntry,
      revertedTo: `Estado revertido a "${revertedStatus}"`
    };
  }
}

export default new TireService();
