import { getTenantDb } from '../db/tenantConnections.js';
import { roleOf } from '../utils/statuses.js';
import { generatePositions } from '../utils/axles.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const round = (n) => Math.round(n);
const round1 = (n) => Math.round(n * 10) / 10;
const avg = (nums) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0);

// Corte de fecha para 'stages' (única sección afectada por range). 'all' = sin filtro.
function rangeCutoff(range) {
  if (range === '12m') return new Date(Date.now() - 365 * DAY_MS);
  if (range === '6m') return new Date(Date.now() - 180 * DAY_MS);
  return null;
}

// Reportes de kilometraje de la flota del tenant (panel admin). Lee el data plane vía
// getTenantDb (patrón de stats/receipts service; las rutas admin no usan attachDb).
export async function getTenantReports(dbName, statuses, { range } = {}) {
  const { Tire, History } = getTenantDb(dbName).models;

  const tires = await Tire.find().select('brand status kilometers').lean();
  const totalTires = tires.length;

  // Solo cubiertas con kilometraje acumulado entran en las métricas de vida útil.
  const analizadas = tires.filter((t) => t.kilometers > 0);
  const total = analizadas.length;
  const fleetLife = total ? round(avg(analizadas.map((t) => t.kilometers))) : 0;

  // % de descarte SOBRE TODAS las cubiertas (no solo las analizadas).
  const discardCountGlobal = tires.filter((t) => roleOf(statuses, t.status) === 'discard').length;
  const discardRate = totalTires ? round1((discardCountGlobal / totalTires) * 100) : 0;

  // Recaps por cubierta: cambios de estado (o su corrección) hacia un rol 'stock'.
  const analizadaIds = analizadas.map((t) => t._id);
  const stockHistory = analizadaIds.length
    ? await History.find({ tire: { $in: analizadaIds }, type: { $in: ['Estado', 'Corrección-Estado'] } })
        .select('tire status')
        .lean()
    : [];
  const recapsByTire = new Map();
  for (const h of stockHistory) {
    if (roleOf(statuses, h.status) !== 'stock') continue;
    const key = String(h.tire);
    recapsByTire.set(key, (recapsByTire.get(key) || 0) + 1);
  }

  // Agrupa las analizadas por marca ('—' si no tiene) y calcula sus métricas.
  const byBrand = new Map();
  for (const t of analizadas) {
    const name = t.brand || '—';
    if (!byBrand.has(name)) byBrand.set(name, []);
    byBrand.get(name).push(t);
  }
  const brands = [...byBrand.entries()]
    .map(([name, group]) => {
      const discardCount = group.filter((t) => roleOf(statuses, t.status) === 'discard').length;
      const recapCounts = group.map((t) => recapsByTire.get(String(t._id)) || 0);
      return {
        name,
        count: group.length,
        life: round(avg(group.map((t) => t.kilometers))),
        recaps: round1(avg(recapCounts)),
        discardRate: round1((discardCount / group.length) * 100),
      };
    })
    .sort((a, b) => b.life - a.life);

  const leader = brands.length ? { name: brands[0].name, life: brands[0].life } : null;

  // Etapas del ciclo (todo rol menos discard): km promedio de desasignaciones en esa etapa.
  const stageStatuses = statuses.filter((s) => s.role !== 'discard');
  const cutoff = rangeCutoff(range);
  const stageFilter = { type: 'Desasignación', status: { $in: stageStatuses.map((s) => s.name) } };
  if (cutoff) stageFilter.date = { $gte: cutoff };
  const stageHistory = stageStatuses.length ? await History.find(stageFilter).select('status km').lean() : [];
  const kmByStatus = new Map();
  for (const h of stageHistory) {
    if (!kmByStatus.has(h.status)) kmByStatus.set(h.status, []);
    kmByStatus.get(h.status).push(h.km || 0);
  }
  const stages = stageStatuses.map((s) => ({
    label: s.name,
    role: s.role,
    km: kmByStatus.has(s.name) ? round(avg(kmByStatus.get(s.name))) : 0,
  }));

  return { total, fleetLife, discardRate, leader, brands, stages };
}

// Desgaste de cubiertas por vehículo: cuánto km "gastó" cada móvil en cubiertas y cada cuánto
// las rota. El km del período vive en la Desasignación (campo km) pero con vehicle:null, así que
// se atribuye pareando cada Asignación (que sí trae el vehículo) con su Desasignación siguiente,
// recorriendo el historial por cubierta y en orden. Además arma el esquema de ejes de cada
// camión (positions) con la cubierta montada en cada posición, para el corte "por camión".
export async function getVehicleReports(dbName, statuses = []) {
  const { Vehicle, History, Tire } = getTenantDb(dbName).models;

  const vehicles = await Vehicle.find().select('mobile licensePlate brand axles').lean();
  if (!vehicles.length) return { vehicles: [] };

  // Nivel en la escalera (Nueva=0, 1er=1, ...) para colorear cada posición por su recapado.
  const levelOf = {};
  let lvl = 0;
  for (const s of statuses) if (s?.role === 'initial' || s?.role === 'stock') levelOf[s.name] = lvl++;

  const moves = await History.find({ type: { $in: ['Asignación', 'Desasignación'] } })
    .select('tire type vehicle kmAlta kmBaja km date')
    .sort({ tire: 1, date: 1 })
    .lean();

  const acc = new Map(); // vehId → { kmTotal, stints, tires:Set(tireId) }
  const ensure = (id) => {
    const k = String(id);
    if (!acc.has(k)) acc.set(k, { kmTotal: 0, stints: 0, tires: new Set() });
    return acc.get(k);
  };

  // Recorre por cubierta manteniendo el período abierto (última Asignación con su vehículo).
  let open = null;
  let currentTire = null;
  for (const m of moves) {
    const tireKey = String(m.tire);
    if (tireKey !== currentTire) { open = null; currentTire = tireKey; }
    if (m.type === 'Asignación') {
      open = { vehicle: m.vehicle, kmAlta: m.kmAlta || 0 };
      if (m.vehicle) ensure(m.vehicle).tires.add(tireKey);
    } else if (m.type === 'Desasignación') {
      if (open?.vehicle) {
        const km = m.km != null ? m.km : Math.max(0, (m.kmBaja || 0) - open.kmAlta);
        const a = ensure(open.vehicle);
        a.kmTotal += km;
        a.stints += 1;
      }
      open = null;
    }
  }

  // Cubiertas actualmente montadas, indexadas por vehículo y por posición (para el esquema de ejes).
  const mounted = await Tire.find({ vehicle: { $ne: null } }).select('vehicle position code brand status kilometers').lean();
  const mountedByVeh = new Map();
  for (const t of mounted) {
    const k = String(t.vehicle);
    if (!mountedByVeh.has(k)) mountedByVeh.set(k, { count: 0, byPos: {} });
    const e = mountedByVeh.get(k);
    e.count += 1;
    if (t.position) e.byPos[t.position] = t;
  }

  const rows = vehicles
    .map((v) => {
      const a = acc.get(String(v._id)) || { kmTotal: 0, stints: 0, tires: new Set() };
      const m = mountedByVeh.get(String(v._id)) || { count: 0, byPos: {} };
      // Esquema de ejes del camión: cada posición con su cubierta montada (o null) y su desgaste.
      const positions = generatePositions(v.axles || []).map((p) => {
        const t = m.byPos[p.code];
        return {
          code: p.code,
          axle: p.axle,
          tire: t ? { code: t.code, brand: t.brand, status: t.status, role: roleOf(statuses, t.status), level: levelOf[t.status] ?? null, km: t.kilometers || 0 } : null,
        };
      });
      return {
        id: String(v._id),
        mobile: v.mobile,
        licensePlate: v.licensePlate,
        brand: v.brand,
        tires: a.tires.size,
        stints: a.stints,
        kmTotal: round(a.kmTotal),
        avgKmPerStint: a.stints ? round(a.kmTotal / a.stints) : 0,
        mounted: m.count,
        hasAxles: positions.length > 0,
        positions,
      };
    })
    .sort((x, y) => y.kmTotal - x.kmTotal);

  return { vehicles: rows };
}
