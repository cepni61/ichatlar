import { describe, expect, it } from 'vitest';
import { actorInTree, type OrgTree, type OrgUnit } from '../../src/domain/org.js';
import { departmentsOf } from '../../src/domain/permissions.js';

const unit = (id: string, parentId: string | null, directorate: string | null = null): [string, OrgUnit] =>
  [id, { id, parentId, active: true, directorate }];

const tree: OrgTree = new Map([
  unit('spesifik', null, 'Saha Grubu'), unit('spesifik-a', 'spesifik'),
  unit('temel', null, 'Saha Grubu'), unit('temel-a', 'temel'),
  unit('tuketici', null, 'Saha Grubu'),
  unit('finans', null), unit('finans-a', 'finans'),
]);

describe('direktörlük', () => {
  it('aynı direktörlükteki departmanlar Tüm Kayıtlar kapsamına girer', () => {
    const a = actorInTree({ id: 'u', role: 'TEAM_MEMBER', departmentId: 'temel-a' }, tree);
    expect(departmentsOf(a).sort()).toEqual(['spesifik', 'temel', 'tuketici']);
  });

  it('direktörlüğü olmayan departman yalnızca kendisini görür; sorumluluk korunur', () => {
    expect(departmentsOf(actorInTree({ id: 'u', role: 'USER', departmentId: 'finans-a' }, tree))).toEqual(['finans']);
    const head = actorInTree({ id: 'u', role: 'USER', departmentId: 'finans-a', headOf: ['temel'] }, tree);
    expect(departmentsOf(head).sort()).toEqual(['finans', 'temel']);
  });
});
