import { describe, expect, it } from 'vitest';
import { metSla, slaCompliancePct } from '../../src/domain/sla-compliance.js';

const now = Date.parse('2026-10-07T12:00:00Z');
const h = (hours: number) => new Date(now + hours * 3600_000);
const row = (dueIn: number, finishedAgo: number | null = null) => ({
  slaDueAt: h(dueIn), resolvedAt: finishedAgo == null ? null : h(-finishedAgo), closedAt: null,
});

describe('SLA uyumu', () => {
  it('hedeften önce çözülen tuttu, hedeften sonra çözülen tutmadı', () => {
    expect(metSla(row(-10, 20), false, now)).toBe(true);  // hedef 10 sa önce, 20 sa önce çözüldü
    expect(metSla(row(-10, 5), false, now)).toBe(false);  // hedef 10 sa önce, 5 sa önce çözüldü
  });

  it('süresi dolmuş açık kayıt tutmadı; dolmamış açık kayıt henüz sonuçlanmadı', () => {
    expect(metSla(row(-1), true, now)).toBe(false);
    expect(metSla(row(+5), true, now)).toBeNull();
  });

  it('çözüm zamanı yoksa kapanış zamanına bakılır (reddedilen kayıt)', () => {
    expect(metSla({ slaDueAt: h(-10), resolvedAt: null, closedAt: h(-2) }, false, now)).toBe(false);
  });

  it('oran yalnızca sonuçlanmış kayıtlardan; geç çözülen artık uyumlu sayılmaz', () => {
    const rows = [
      { ...row(-10, 20), open: false }, // tuttu
      { ...row(-10, 5), open: false },  // geç çözüldü (eskiden "zamanında" sayılıyordu)
      { ...row(-1), open: true },       // gecikmiş açık
      { ...row(+5), open: true },       // henüz sonuçlanmadı → orana girmez
    ];
    expect(slaCompliancePct(rows, (r) => r.open, now)).toBe(33);
    expect(slaCompliancePct([{ ...row(+5), open: true }], (r) => r.open, now)).toBeNull();
  });
});
