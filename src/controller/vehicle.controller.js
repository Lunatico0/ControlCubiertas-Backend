import { addHistoryEntry } from '../utils/utils.js';
import { buildVehiclePositions, generatePositions } from '../utils/axles.js';
import { normalizePlate } from '../utils/plate.js';
import { httpError } from '../utils/httpError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// Pre-check de duplicados de vehículo (mismo criterio en alta y edición): mensaje amable en vez
// de dejar explotar el índice único → evita filtrar el error crudo de Mongo (E11000 + nombre de
// la DB del tenant + índice). `field` le dice al front qué campo marcar en rojo. En edición se
// pasa `excludeId` para no chocar contra el propio documento.
async function assertVehicleUnique(db, { mobile, plate, excludeId }) {
  const scope = (extra) => (excludeId ? { ...extra, _id: { $ne: excludeId } } : extra);
  if (await db.Vehicle.findOne(scope({ mobile }))) {
    throw httpError('Ya existe un vehículo con ese número de móvil', 400, 'mobile');
  }
  if (await db.Vehicle.findOne(scope({ licensePlate: plate }))) {
    throw httpError('Ya existe un vehículo con esa patente', 400, 'licensePlate');
  }
}

// Modelos vía req.db (inyectado por attachDb). El historial vive en la colección History
// (no en el doc Tire): por eso usamos addHistoryEntry y NO tire.history.push (Bug 5 resuelto).
//
// create/update/updateDetails/updateAxles/createVehicleType se dejan con try/catch a propósito:
// hoy mapean el error genérico a un status fijo (400) o a un mensaje/wrapper propio (500 "Error
// al actualizar el vehículo"). El middleware central solo reproduce "status || 500", así que el
// catch es necesario para preservar ese contrato. Las lecturas (→ 500) sí se convirtieron.
class VehicleController {
  getAll = asyncHandler(async (req, res) => {
    const vehicles = await req.db.Vehicle.find().populate('tires');
    res.json(vehicles);
  });

  // req.vehicle lo deja validateVehicleExists: un id malformado sale 400 y uno inexistente 404.
  // Antes esta ruta devolvía 200 con body null y el frontend tenía que adivinar si eso era un
  // vacío legítimo o un error, mientras su vecina getPositions ya contestaba 404 al mismo input.
  getById = asyncHandler(async (req, res) => {
    await req.vehicle.populate('tires');
    res.json(req.vehicle);
  });

  // Esquema de ejes del vehículo + qué cubierta ocupa cada posición (o null si libre).
  // Lo consume el frontend para dibujar el vehículo y ofrecer el selector al montar.
  getPositions = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const vehicle = await req.db.Vehicle.findById(id);
    if (!vehicle) return res.status(404).json({ message: 'Vehículo no encontrado' });

    const tires = await req.db.Tire.find({ vehicle: id });
    const positions = buildVehiclePositions(vehicle.axles, tires);

    res.json({ vehicleId: String(vehicle._id), axles: vehicle.axles, positions });
  });

  // Configurar el esquema de ejes de un vehículo existente (migración A4: adaptar los
  // vehículos viejos al modelo de ejes). Setea axles (+ kilometers opcional).
  async updateAxles(req, res) {
    try {
      const { id } = req.params;
      const { axles, kilometers, type } = req.body;

      const vehicle = await req.db.Vehicle.findById(id);
      if (!vehicle) return res.status(404).json({ message: 'Vehículo no encontrado' });

      // Guard duro: no RECONFIGURAR si alguna cubierta montada perdería su posición. Se
      // comparan las posiciones ocupadas (tire.position, ej. E2-DE) contra las que genera el
      // layout nuevo; si alguna desaparece → 409 (hay que desasignarla primero). Una cubierta
      // montada SIN posición (modelo viejo) también bloquea: no se puede verificar el eje.
      // Solo aplica si el vehículo YA tiene ejes: en la PRIMERA configuración (axles vacío,
      // migración) no hay posiciones que orfanar aunque haya cubiertas montadas.
      const mounted = await req.db.Tire.find({ vehicle: id });
      if (vehicle.axles?.length && mounted.length) {
        const newCodes = new Set(generatePositions(axles).map((p) => p.code));
        const conflicts = mounted.filter((t) => !t.position || !newCodes.has(t.position));
        if (conflicts.length) {
          return res.status(409).json({
            message: 'Desasigná las cubiertas montadas antes de reconfigurar los ejes.',
            positions: conflicts.map((t) => t.position).filter(Boolean),
          });
        }
      }

      vehicle.axles = axles;
      if (kilometers !== undefined) vehicle.kilometers = kilometers;
      if (type !== undefined) vehicle.type = type;
      await vehicle.save();

      res.json(vehicle);
    } catch (error) {
      console.error('Error al configurar ejes del vehículo:', error.message);
      res.status(400).json({ message: error.message });
    }
  }

  // Tipos de vehículo custom del tenant (data-plane). Los presets viven en el front; acá
  // solo los que el usuario guarda. Nombre único (validado en código, no por índice).
  listVehicleTypes = asyncHandler(async (req, res) => {
    const types = await req.db.VehicleType.find().sort({ name: 1 });
    res.json(types);
  });

  async createVehicleType(req, res) {
    try {
      const name = (req.body.name || '').trim();
      const { axles } = req.body;
      const exists = await req.db.VehicleType.findOne({ name });
      if (exists) return res.status(409).json({ message: `Ya existe un tipo de vehículo llamado "${name}"` });
      const vt = await req.db.VehicleType.create({ name, axles });
      res.status(201).json(vt);
    } catch (error) {
      console.error('Error al crear tipo de vehículo:', error.message);
      res.status(400).json({ message: error.message });
    }
  }

  async create(req, res) {
    const { brand, mobile, licensePlate, type, tires, axles, kilometers } = req.body;

    try {
      // Verificar si alguna de las cubiertas ya está asignada a otro vehículo
      const conflictingTires = await req.db.Tire.find({
        _id: { $in: tires },
        vehicle: { $ne: null },
      });

      if (conflictingTires.length > 0) {
        return res.status(400).json({
          message: "Algunas cubiertas ya están asignadas a otros vehículos",
          conflictingTires,
        });
      }

      // Patente normalizada (MAYÚSCULAS, sin símbolos): así "ABC-301" == "ABC301" y no se
      // puede evadir el chequeo de duplicados con un guion.
      const plate = normalizePlate(licensePlate);

      await assertVehicleUnique(req.db, { mobile, plate });

      // Crear el nuevo vehículo (axles/kilometers opcionales: defaults [] y 0 vía schema)
      const newVehicle = new req.db.Vehicle({ brand, mobile, licensePlate: plate, type, axles, kilometers, tires: [] });
      await newVehicle.save();

      await Promise.all(
        tires.map(async (tireId) => {
          const tire = await req.db.Tire.findById(tireId);
          if (tire) {
            tire.vehicle = newVehicle._id;

            await addHistoryEntry(req.db.History, tire._id, {
              type: 'Asignación',
              vehicle: newVehicle._id,
              kmAlta: tire.kilometers,
              status: tire.status,
            });

            await tire.save();
          }
        })
      );

      // Sólo las cubiertas que EXISTEN. El loop de arriba saltea las que no, así que copiar
      // el array del body tal cual metía refs colgadas en vehicle.tires[] desde el alta.
      const existentes = await req.db.Tire.find({ _id: { $in: tires } }).select('_id');
      newVehicle.tires = existentes.map((t) => t._id);
      await newVehicle.save();

      res.status(201).json(newVehicle);
    } catch (error) {
      console.error("Error al crear el vehículo: ", error.message);
      res.status(error.status || 400).json({ message: error.message, ...(error.field ? { field: error.field } : {}) });
    }
  }

  async update(req, res) {
    try {
      const { id } = req.params;
      const { tires } = req.body;

      if (!tires || !Array.isArray(tires)) {
        return res.status(400).json({ message: "Debe proporcionar un array válido de cubiertas" });
      }

      const vehicle = await req.db.Vehicle.findById(id).populate("tires");
      if (!vehicle) {
        return res.status(404).json({ message: "Vehículo no encontrado" });
      }

      const currentTires = Array.isArray(vehicle.tires) ? vehicle.tires.map((tire) => String(tire._id)) : [];

      const conflictingTires = await req.db.Tire.find({
        _id: { $in: tires.filter((tireId) => !currentTires.includes(tireId)) },
        vehicle: { $ne: id, $ne: null },
      });

      if (conflictingTires.length > 0) {
        return res.status(400).json({
          message: "Algunas cubiertas ya están asignadas a otros vehículos",
          conflictingTires,
        });
      }

      const tiresToRemove = currentTires.filter((tireId) => !tires.includes(tireId));

      try {
        await req.db.Tire.updateMany(
          { _id: { $in: tiresToRemove } },
          { $set: { vehicle: null } }
        );
      } catch (error) {
        console.error("Error al desvincular cubiertas:", error.message);
      }

      for (const tireId of tiresToRemove) {
        const tire = await req.db.Tire.findById(tireId);
        if (tire) {
          await addHistoryEntry(req.db.History, tire._id, {
            type: 'Desasignación',
            vehicle: null,
            km: tire.kilometers,
            status: tire.status,
          });
          await tire.save();
        }
      }

      try {
        await req.db.Tire.updateMany(
          { _id: { $in: tires } },
          { $set: { vehicle: id } }
        );
      } catch (error) {
        console.error("Error al asignar nuevas cubiertas:", error.message);
      }

      for (const tireId of tires) {
        const tire = await req.db.Tire.findById(tireId);
        if (tire) {
          await addHistoryEntry(req.db.History, tire._id, {
            type: 'Asignación',
            vehicle: id || null,
            kmAlta: tire.kilometers,
            status: tire.status,
          });
          await tire.save();
        }
      }

      // Sin este save() el array quedaba sólo en el documento en memoria: se respondía 200 con
      // el estado viejo y los dos lados de la relación quedaban en desacuerdo permanente.
      const asignadas = await req.db.Tire.find({ _id: { $in: tires } }).select('_id');
      vehicle.tires = asignadas.map((t) => t._id);
      await vehicle.save();

      const populatedVehicle = await req.db.Vehicle.findById(id).populate("tires");
      res.json(populatedVehicle);

    } catch (error) {
      console.error("Error al actualizar el vehículo: ", error.message);
      res.status(500).json({ message: "Error al actualizar el vehículo", error: error.message });
    }
  }

  async updateDetails(req, res) {
    try {
      const { id } = req.params;
      const { mobile, licensePlate, brand, type } = req.body;

      const vehicle = await req.db.Vehicle.findById(id);
      if (!vehicle) {
        return res.status(404).json({ message: "Vehículo no encontrado" });
      }

      // Patente normalizada (MAYÚSCULAS, sin símbolos): "ABC-301" == "ABC301".
      const plate = normalizePlate(licensePlate);

      await assertVehicleUnique(req.db, { mobile, plate, excludeId: id });

      vehicle.mobile = mobile;
      vehicle.licensePlate = plate;
      vehicle.brand = brand;
      vehicle.type = type;

      const updated = await vehicle.save();
      res.json(updated);
    } catch (error) {
      console.error("Error al actualizar detalles del vehículo:", error.message);
      // Duplicado (httpError con status/field): mensaje amable 400 + field. Cualquier otro
      // error mantiene el wrapper 500 histórico (no filtra el error crudo de Mongo).
      if (error.status) {
        return res.status(error.status).json({ message: error.message, ...(error.field ? { field: error.field } : {}) });
      }
      res.status(500).json({ message: "Error al actualizar el vehículo", error: error.message });
    }
  }
}

export default new VehicleController();
