import { describe, expect, it } from 'vitest';
import {
  allowedTransitions,
  can,
  canTransition,
  maySeeCreator,
  type Actor,
  type RecordShape,
} from '../../src/domain/permissions.js';
import { RecordStatus, Role } from '../../src/domain/enums.js';

/*
 * README "Durum makinesi" tablosundaki kurallar:
 *   Üzerime al              → kayıt açıkken, ekipten biri, sahip yoksa
 *   Yönlendir               → kayıt açıkken, ekipten biri
 *   Durum / Çözüldü / Reddet → kayıt açıkken, yalnızca sahibi
 *   Kapat                   → durum Çözüldü iken, yalnızca açan
 *   Yorum / dosya           → kaydı görebilen herkes
 */

const IK = 'dept-ik';
const KALITE = 'dept-kalite';

const actor = (id: string, role: Role, departmentId: string | null = null): Actor => ({ id, role, departmentId });

const opener = actor('opener', Role.USER, KALITE);
const ikMember = actor('ik-1', Role.TEAM_MEMBER, IK);
const ikMember2 = actor('ik-2', Role.TEAM_MEMBER, IK);
const ikManager = actor('ik-mgr', Role.MANAGER, IK);
const kaliteMember = actor('kalite-1', Role.TEAM_MEMBER, KALITE);
const ikPlainUser = actor('ik-user', Role.USER, IK);
const admin = actor('admin', Role.ADMIN, null);

const rec = (over: Partial<RecordShape> = {}): RecordShape => ({
  status: RecordStatus.YENI,
  departmentId: IK,
  department2Id: null,
  createdById: opener.id,
  assigneeId: null,
  anonymous: false,
  ...over,
});

describe('görme (view)', () => {
  it('açan, ekip, sahip, yönetici ve admin görür', () => {
    const r = rec({ assigneeId: ikMember.id, status: RecordStatus.UZERIME_ALINDI });
    for (const a of [opener, ikMember, ikMember2, ikManager, admin]) expect(can('view', r, a)).toBe(true);
  });

  it('başka ekibin üyesi görmez', () => {
    expect(can('view', rec(), kaliteMember)).toBe(false);
  });

  it('ekibin departmanında ama USER rolündeki kişi görmez', () => {
    expect(can('view', rec(), ikPlainUser)).toBe(false);
  });

  it('ikinci ekip (department2) üyesi görür', () => {
    expect(can('view', rec({ department2Id: KALITE }), kaliteMember)).toBe(true);
  });

  it('departmanı olmayan kullanıcı ekip üzerinden hiçbir kaydı görmez', () => {
    expect(can('view', rec(), actor('x', Role.TEAM_MEMBER, null))).toBe(false);
  });
});

describe('üzerime al (claim)', () => {
  it('ekip üyesi sahipsiz açık kaydı alır', () => {
    expect(can('claim', rec(), ikMember)).toBe(true);
  });

  it('sahibi olan kayıt ikinci kez alınamaz', () => {
    expect(can('claim', rec({ assigneeId: ikMember.id, status: RecordStatus.UZERIME_ALINDI }), ikMember2)).toBe(false);
  });

  it('başka ekip ve kaydı açan alamaz', () => {
    expect(can('claim', rec(), kaliteMember)).toBe(false);
    expect(can('claim', rec(), opener)).toBe(false);
  });

  it('kapanmış kayıt alınamaz', () => {
    for (const status of [RecordStatus.COZULDU, RecordStatus.KAPATILDI, RecordStatus.REDDEDILDI]) {
      expect(can('claim', rec({ status }), ikMember)).toBe(false);
    }
  });
});

describe('durum / çözüldü / reddet', () => {
  const owned = rec({ assigneeId: ikMember.id, status: RecordStatus.CALISILIYOR });

  it('yalnızca sahibi (ve admin) değiştirir', () => {
    for (const action of ['status', 'resolve', 'reject'] as const) {
      expect(can(action, owned, ikMember)).toBe(true);
      expect(can(action, owned, admin)).toBe(true);
      expect(can(action, owned, ikMember2)).toBe(false);
      expect(can(action, owned, ikManager)).toBe(false);
      expect(can(action, owned, opener)).toBe(false);
    }
  });

  it('kapanmış kayıtta kimse değiştiremez, admin dahil', () => {
    const closed = rec({ assigneeId: ikMember.id, status: RecordStatus.KAPATILDI });
    expect(can('resolve', closed, ikMember)).toBe(false);
    expect(can('resolve', closed, admin)).toBe(false);
  });
});

describe('kapat (close)', () => {
  const resolved = rec({ assigneeId: ikMember.id, status: RecordStatus.COZULDU });

  it('çözülen kaydı yalnızca açan (ve admin) kapatır', () => {
    expect(can('close', resolved, opener)).toBe(true);
    expect(can('close', resolved, admin)).toBe(true);
    expect(can('close', resolved, ikMember)).toBe(false);
  });

  it('çözülmemiş kayıt kapatılamaz', () => {
    expect(can('close', rec({ status: RecordStatus.CALISILIYOR }), opener)).toBe(false);
  });
});

describe('yönlendir (forward)', () => {
  it('ekip üyesi ve admin yönlendirir, açan ve başka ekip yönlendiremez', () => {
    expect(can('forward', rec(), ikMember)).toBe(true);
    expect(can('forward', rec(), admin)).toBe(true);
    expect(can('forward', rec(), opener)).toBe(false);
    expect(can('forward', rec(), kaliteMember)).toBe(false);
  });
});

describe('yorum ve dosya', () => {
  it('görmeye bağlı', () => {
    expect(can('comment', rec(), opener)).toBe(true);
    expect(can('attach', rec(), ikMember)).toBe(true);
    expect(can('comment', rec(), kaliteMember)).toBe(false);
  });
});

describe('anonim kayıtta açan kimliği', () => {
  const anon = rec({ anonymous: true });

  it('yalnızca açan ve admin görür', () => {
    expect(maySeeCreator(anon, opener)).toBe(true);
    expect(maySeeCreator(anon, admin)).toBe(true);
    expect(maySeeCreator(anon, ikMember)).toBe(false);
    expect(maySeeCreator(anon, ikManager)).toBe(false);
  });

  it('anonim olmayan kayıtta herkes görür', () => {
    expect(maySeeCreator(rec(), ikMember)).toBe(true);
  });
});

describe('durum geçişleri', () => {
  it('kapanmış ve reddedilmiş kayıttan çıkış yok', () => {
    expect(allowedTransitions(RecordStatus.KAPATILDI)).toEqual([]);
    expect(allowedTransitions(RecordStatus.REDDEDILDI)).toEqual([]);
  });

  it('yeni kayıt doğrudan çözülemez', () => {
    expect(canTransition(RecordStatus.YENI, RecordStatus.COZULDU)).toBe(false);
  });

  it('çözülen kayıt kapanabilir veya yeniden çalışılmaya alınabilir', () => {
    expect(canTransition(RecordStatus.COZULDU, RecordStatus.KAPATILDI)).toBe(true);
    expect(canTransition(RecordStatus.COZULDU, RecordStatus.CALISILIYOR)).toBe(true);
    expect(canTransition(RecordStatus.COZULDU, RecordStatus.YENI)).toBe(false);
  });

  it('bilinmeyen durumdan geçiş yok', () => {
    expect(canTransition('BOZUK', RecordStatus.COZULDU)).toBe(false);
  });
});
