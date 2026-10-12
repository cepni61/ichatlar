import { describe, expect, it } from 'vitest';
import { addWorkingHours, autoCloseDeadline, parseWorkHours } from '../../src/domain/work-hours.js';

// 2026-10-12 pazartesi. Saatler İstanbul saatiyle (+03:00).
const at = (s: string) => new Date(`${s}+03:00`);
const day = parseWorkHours('08:00-17:00');

describe('mesai saati', () => {
  it('aynı gün içinde', () => {
    expect(addWorkingHours(at('2026-10-12T10:00:00'), 4, day)).toEqual(at('2026-10-12T14:00:00'));
  });

  it('akşama taşan süre ertesi sabaha devreder', () => {
    expect(addWorkingHours(at('2026-10-12T15:00:00'), 4, day)).toEqual(at('2026-10-13T10:00:00'));
  });

  it('cuma öğleden sonra → pazartesi', () => {
    expect(addWorkingHours(at('2026-10-16T16:00:00'), 4, day)).toEqual(at('2026-10-19T11:00:00'));
  });

  it('hafta sonu ve mesai dışı başlangıç mesainin başından sayılır', () => {
    expect(addWorkingHours(at('2026-10-17T12:00:00'), 4, day)).toEqual(at('2026-10-19T12:00:00'));
    expect(addWorkingHours(at('2026-10-12T06:00:00'), 4, day)).toEqual(at('2026-10-12T12:00:00'));
    expect(addWorkingHours(at('2026-10-12T18:30:00'), 4, day)).toEqual(at('2026-10-13T12:00:00'));
  });

  it('süre 0 ise kendiliğinden kapanma yok', () => {
    expect(autoCloseDeadline(at('2026-10-12T10:00:00'), 0, day)).toBeNull();
    expect(autoCloseDeadline(at('2026-10-12T10:00:00'), 4, day)).toEqual(at('2026-10-12T14:00:00'));
  });

  it('mesai aralığı biçimi denetlenir', () => {
    expect(parseWorkHours('08:30-17:30')).toEqual({ startMin: 510, endMin: 1050 });
    expect(() => parseWorkHours('17:00-08:00')).toThrow();
    expect(() => parseWorkHours('8-17')).toThrow();
  });
});
