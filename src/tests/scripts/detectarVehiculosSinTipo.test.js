import {
  PRESETS_TIPO,
  necesitaTipo,
  proponerTipo,
  clasificarVehiculos,
} from '../../../scripts/detectar-vehiculos-sin-tipo.js';

// M1 (auditoría 2026-10-26): detectar los vehículos a los que S1 les borró el tipo y proponer
// uno comparando sus ejes contra el catálogo (presets del front + tipos custom del tenant).
// Solo una coincidencia ÚNICA se puede aplicar sola; lo ambiguo, lo sin ejes y lo que no
// coincide con nada queda listado para resolver a mano.

const ejes = (...tipos) => tipos.map((type) => ({ type }));

describe('necesitaTipo', () => {
  it('marca los vehículos sin tipo, con null, vacío o solo espacios', () => {
    expect(necesitaTipo({})).toBe(true);
    expect(necesitaTipo({ type: undefined })).toBe(true);
    expect(necesitaTipo({ type: null })).toBe(true);
    expect(necesitaTipo({ type: '' })).toBe(true);
    expect(necesitaTipo({ type: '   ' })).toBe(true);
  });

  it('deja en paz los que tienen tipo', () => {
    expect(necesitaTipo({ type: 'Camión 4×2' })).toBe(false);
    expect(necesitaTipo({ type: 'Personalizado' })).toBe(false);
  });
});

describe('proponerTipo', () => {
  it('sin ejes no propone nada', () => {
    expect(proponerTipo({ axles: [] }, [])).toEqual({ estado: 'sin-ejes' });
    expect(proponerTipo({}, [])).toEqual({ estado: 'sin-ejes' });
  });

  it('coincidencia única contra un preset', () => {
    expect(proponerTipo({ axles: ejes('simple', 'dual') }, [])).toEqual({ estado: 'unico', tipo: 'Camión 4×2' });
    expect(proponerTipo({ axles: ejes('dual', 'dual', 'dual') }, [])).toEqual({ estado: 'unico', tipo: 'Semirremolque 3 ejes' });
  });

  it('coincidencia única contra un tipo custom del tenant', () => {
    const custom = [{ name: 'Tractor raro', axles: ['simple', 'simple', 'dual'] }];
    expect(proponerTipo({ axles: ejes('simple', 'simple', 'dual') }, custom)).toEqual({ estado: 'unico', tipo: 'Tractor raro' });
  });

  it('es ambiguo si un custom comparte el layout de un preset (o de otro custom)', () => {
    const custom = [{ name: 'Chasis liviano', axles: ['simple', 'dual'] }];
    expect(proponerTipo({ axles: ejes('simple', 'dual') }, custom)).toEqual({
      estado: 'ambiguo',
      candidatos: ['Camión 4×2', 'Chasis liviano'],
    });
  });

  it('un custom con el MISMO nombre y layout que un preset no lo vuelve ambiguo', () => {
    const custom = [{ name: ' Camión 4×2 ', axles: ['simple', 'dual'] }];
    expect(proponerTipo({ axles: ejes('simple', 'dual') }, custom)).toEqual({ estado: 'unico', tipo: 'Camión 4×2' });
  });

  it('el orden de los ejes importa (delantero a trasero)', () => {
    expect(proponerTipo({ axles: ejes('dual', 'simple') }, [])).toEqual({
      estado: 'sin-coincidencia',
      layout: ['dual', 'simple'],
    });
  });

  it('acepta los ejes como strings además de como objetos { type }', () => {
    expect(proponerTipo({ axles: ['moto', 'moto'] }, [])).toEqual({ estado: 'unico', tipo: 'Moto' });
  });
});

describe('PRESETS_TIPO', () => {
  it('tiene un layout distinto por preset (si no, matchType del front dejaría uno inaccesible)', () => {
    const layouts = PRESETS_TIPO.map((p) => p.axles.join(','));
    expect(new Set(layouts).size).toBe(layouts.length);
  });
});

describe('clasificarVehiculos', () => {
  it('reparte solo los vehículos sin tipo en único / ambiguo / sin ejes / sin coincidencia', () => {
    const custom = [{ name: 'Chasis liviano', axles: ['simple', 'dual'] }];
    const vehiculos = [
      { _id: 'a', mobile: '102', type: undefined, axles: ejes('dual', 'dual') },
      { _id: 'b', mobile: '201', type: null, axles: ejes('simple', 'dual') },
      { _id: 'c', mobile: 'D902', type: '', axles: [] },
      { _id: 'd', mobile: '300', axles: ejes('moto', 'dual') },
      { _id: 'e', mobile: '400', type: 'Camión 6×4', axles: ejes('simple', 'dual', 'dual') },
    ];

    const r = clasificarVehiculos(vehiculos, custom);

    expect(r.unicos).toEqual([{ _id: 'a', mobile: '102', tipo: 'Semirremolque 2 ejes' }]);
    expect(r.ambiguos).toEqual([{ _id: 'b', mobile: '201', candidatos: ['Camión 4×2', 'Chasis liviano'] }]);
    expect(r.sinEjes).toEqual([{ _id: 'c', mobile: 'D902' }]);
    expect(r.sinCoincidencia).toEqual([{ _id: 'd', mobile: '300', layout: ['moto', 'dual'] }]);
  });
});
