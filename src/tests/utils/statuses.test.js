import { normalizeStatuses, inferRole, assertValidStatuses, nameByRole, roleOf } from '../../utils/statuses.js';

describe('statuses helper (estados configurables con rol)', () => {
  describe('inferRole (heurística de migración por nombre)', () => {
    it('mapea nombres conocidos a su rol', () => {
      expect(inferRole('Nueva')).toBe('initial');
      expect(inferRole('A recapar')).toBe('recap');
      expect(inferRole('Descartada')).toBe('discard');
      expect(inferRole('1er Recapado')).toBe('stock');
      expect(inferRole('Cualquier cosa')).toBe('stock');
    });
  });

  describe('normalizeStatuses', () => {
    it('convierte legacy [String] a [{name,role}] y garantiza initial + discard', () => {
      const out = normalizeStatuses(['Nueva', '1er Recapado', '2do Recapado']);
      expect(out.find((s) => s.name === 'Nueva').role).toBe('initial');
      expect(out.find((s) => s.name === '1er Recapado').role).toBe('stock');
      expect(out.filter((s) => s.role === 'initial')).toHaveLength(1);
      expect(out.some((s) => s.role === 'discard')).toBe(true); // legacy no lo tenía → se agrega
    });

    it('es idempotente sobre un set ya válido (no agrega recap si no está)', () => {
      const input = [
        { name: 'Nueva', role: 'initial' },
        { name: 'Media', role: 'stock' },
        { name: 'Baja', role: 'discard' },
      ];
      expect(normalizeStatuses(input)).toEqual(input);
    });

    it('maneja vacío/undefined devolviendo un set mínimo válido', () => {
      const out = normalizeStatuses(undefined);
      expect(out.some((s) => s.role === 'initial')).toBe(true);
      expect(out.some((s) => s.role === 'discard')).toBe(true);
    });
  });

  describe('assertValidStatuses (invariantes al guardar)', () => {
    const valid = [
      { name: 'Nueva', role: 'initial' },
      { name: '1er Recapado', role: 'stock' },
      { name: 'A recapar', role: 'recap' },
      { name: 'Descartada', role: 'discard' },
    ];
    it('acepta un set válido', () => {
      expect(() => assertValidStatuses(valid)).not.toThrow();
    });
    it('rechaza si falta el estado inicial', () => {
      expect(() => assertValidStatuses(valid.filter((s) => s.role !== 'initial'))).toThrow(/inicial/i);
    });
    it('rechaza si falta el estado descartado', () => {
      expect(() => assertValidStatuses(valid.filter((s) => s.role !== 'discard'))).toThrow(/descart/i);
    });
    it('rechaza dos estados iniciales', () => {
      expect(() => assertValidStatuses([...valid, { name: 'Otra', role: 'initial' }])).toThrow(/inicial/i);
    });
    it('rechaza dos estados descartados', () => {
      expect(() => assertValidStatuses([...valid, { name: 'Otra', role: 'discard' }])).toThrow(/descart/i);
    });
    it('rechaza dos estados a-recapar', () => {
      expect(() => assertValidStatuses([...valid, { name: 'Otra', role: 'recap' }])).toThrow(/recapar/i);
    });
    it('rechaza nombres duplicados (case-insensitive)', () => {
      expect(() => assertValidStatuses([...valid, { name: 'nueva', role: 'stock' }])).toThrow(/duplicad|repetid/i);
    });
    it('rechaza nombres vacíos', () => {
      expect(() => assertValidStatuses([...valid, { name: '  ', role: 'stock' }])).toThrow(/vac/i);
    });
  });

  describe('lookups', () => {
    const s = [
      { name: 'Nueva', role: 'initial' },
      { name: 'Baja', role: 'discard' },
    ];
    it('nameByRole devuelve el nombre del primer estado con ese rol', () => {
      expect(nameByRole(s, 'initial')).toBe('Nueva');
      expect(nameByRole(s, 'discard')).toBe('Baja');
      expect(nameByRole(s, 'recap')).toBeUndefined();
    });
    it('roleOf devuelve el rol de un nombre', () => {
      expect(roleOf(s, 'Nueva')).toBe('initial');
      expect(roleOf(s, 'Inexistente')).toBeUndefined();
    });
  });
});
