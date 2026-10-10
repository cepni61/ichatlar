import { RecordStatus, RecordType, Role } from './enums.js';
import { isOpen, ONERI_OUTCOMES, ONERI_WORK_STATUSES, WORK_STATUSES } from './constants.js';

/**
 * Yetki kuralları tek yerde. Arayüz hangi düğmeyi göstereceğini buradan
 * türetilen izinlerle bilir, ama karar arayüzde verilmez: her aksiyon
 * çağrısında sunucu aynı fonksiyonlarla yeniden doğrular.
 */

/** Ekibin işini yapan roller. USER ekipte görünse de ekip kaydı ona düşmez. */
export const isTeamRole = (role: string) => role === Role.TEAM_MEMBER || role === Role.MANAGER || role === Role.ADMIN;

export interface Actor {
  id: string;
  role: string;
  /** Kişinin ekibi (bkz. domain/org.ts). */
  departmentId: string | null;
  /** Ekibin departmanı. Verilmezse departman genelinde görme kuralı uygulanmaz. */
  departmentRootId?: string | null;
}

/** Veritabanından okunan kayıt. Kolonlar String olduğu için tipler geniş;
  * karşılaştırmalar enums.ts sabitleriyle yapıldığı için güvenli kalır. */
export interface RecordShape {
  status: string;
  /** Verilmezse bilgi talebi sayılır (yalnızca öneriye özel aksiyonlar bakar). */
  type?: string;
  departmentId: string;
  department2Id: string | null;
  createdById: string;
  assigneeId: string | null;
  anonymous: boolean;
  /** "Yalnızca ilgili ekip görsün" — öneri havuzuna eklenemez, yönlendirilemez. */
  restricted?: boolean;
  /** Ekiplerin departmanları (withRoots ile doldurulur). */
  departmentRootId?: string | null;
  department2RootId?: string | null;
}

export type Action =
  | 'view'
  | 'claim'
  | 'forward'
  | 'status'
  | 'resolve'
  | 'reject'
  | 'close'
  | 'reopen'
  | 'comment'
  | 'attach'
  | 'evaluate'
  | 'learn';

export interface Relation {
  isCreator: boolean;
  isAssignee: boolean;
  inTeam: boolean;
  isAdmin: boolean;
  /** Yönetici, kendi ekibinin tüm kayıtlarını görür. */
  isDeptManager: boolean;
  /** Kişinin departmanındaki bir ekibe düşmüş kayıt (Tüm Kayıtlar kapsamı). */
  inDepartment: boolean;
  open: boolean;
}

export function relate(rec: RecordShape, actor: Actor): Relation {
  const inTeam =
    actor.departmentId != null &&
    (actor.departmentId === rec.departmentId || actor.departmentId === rec.department2Id) &&
    isTeamRole(actor.role);

  return {
    isCreator: rec.createdById === actor.id,
    isAssignee: rec.assigneeId != null && rec.assigneeId === actor.id,
    inTeam,
    // "Yalnızca ilgili ekip görsün" kayıtta sistem yöneticisinin ayrıcalığı yok:
    // ekibinde değilse görmez, işlem de yapamaz (kullanıcı isteği, 2026-10-09).
    isAdmin: actor.role === Role.ADMIN && !rec.restricted,
    isDeptManager:
      actor.role === Role.MANAGER &&
      actor.departmentId != null &&
      (actor.departmentId === rec.departmentId || actor.departmentId === rec.department2Id),
    inDepartment:
      actor.departmentRootId != null &&
      (actor.departmentRootId === rec.departmentRootId || actor.departmentRootId === rec.department2RootId),
    open: isOpen(rec.status),
  };
}

export function can(action: Action, rec: RecordShape, actor: Actor): boolean {
  const r = relate(rec, actor);

  switch (action) {
    // Departmandaki diğer ekiplerin kayıtları Tüm Kayıtlar'da görünür ve
    // okunabilir; "yalnızca ilgili ekip" işaretli olanlar hariç.
    case 'view':
      return (
        r.isCreator || r.isAssignee || r.inTeam || r.isAdmin || r.isDeptManager ||
        (r.inDepartment && !rec.restricted)
      );

    // Kayıt kişiye değil ekibe düşer; ekipten biri sahiplenir.
    case 'claim':
      return r.open && r.inTeam && rec.assigneeId == null;

    // Kısıtlı kayıt başka EKİBE yönlendirilemez (ilgili ekip dışına çıkardı);
    // bu kontrol yönlendirme ucunda. Ekip içinde kişiye devir serbest.
    case 'forward':
      return r.open && (r.inTeam || r.isAdmin);

    // Ara durumları ve çözümü yalnızca kaydı üzerine alan kişi değiştirir.
    case 'status':
      return r.open && (r.isAssignee || r.isAdmin);

    // Bilgi talebi çözülür / reddedilir; öneri ise değerlendirilir.
    case 'resolve':
    case 'reject':
      return r.open && (r.isAssignee || r.isAdmin) && rec.type !== RecordType.ONERI;
    case 'evaluate':
      return r.open && (r.isAssignee || r.isAdmin) && rec.type === RecordType.ONERI;

    // "Yenilenen kayıt" (ML hafızası): çözümü yazan kişi ya da sistem yöneticisi.
    // Kısıtlı kayıt öneri havuzuna giremez: çözümü başka ekiplere önerilirdi.
    case 'learn':
      return (
        rec.type !== RecordType.ONERI &&
        !rec.restricted &&
        (rec.status === RecordStatus.COZULDU || rec.status === RecordStatus.KAPATILDI) &&
        (r.isAssignee || r.isAdmin)
      );

    // Çözülen kaydı kapatma hakkı kaydı açanda — çözümün işe yarayıp
    // yaramadığına o karar verir.
    case 'close':
      return rec.status === RecordStatus.COZULDU && (r.isCreator || r.isAdmin);

    // Çözüm işe yaramadıysa açan kişi kaydı yeniden çalışmaya gönderir.
    case 'reopen':
      return rec.status === RecordStatus.COZULDU && (r.isCreator || r.isAdmin);

    // Departman genelinde görme yalnızca okumadır: yorum ve dosya ilgili
    // ekipte, kaydı açanda ve üzerine alanda kalır.
    case 'comment':
    case 'attach':
      return r.isCreator || r.isAssignee || r.inTeam || r.isAdmin || r.isDeptManager;

    default:
      return false;
  }
}

/** Arayüze gönderilen izin listesi — düğme görünürlüğü için. */
export function permissionsFor(rec: RecordShape, actor: Actor) {
  const actions: Action[] = [
    'claim', 'forward', 'status', 'resolve', 'reject', 'close', 'reopen', 'comment', 'attach', 'evaluate', 'learn',
  ];
  const out: Partial<Record<Action, boolean>> = {};
  for (const a of actions) out[a] = can(a, rec, actor);
  return out;
}

/**
 * Geçerli durum geçişleri. Yetki ayrı bir kontrol; bu tablo yalnızca
 * "bu durumdan şuraya gidilebilir mi" sorusunu yanıtlar.
 */
/* Açık bir kayıttan gidilebilecek her yer. Türe özgü sınırlar (öneri yalnızca
   değerlendirilir, bilgi yalnızca çözülür) aksiyon yetkilerinde ve uçlarda. */
const FROM_OPEN: RecordStatus[] = [
  ...WORK_STATUSES, ...ONERI_WORK_STATUSES, ...ONERI_OUTCOMES,
  RecordStatus.COZULDU, RecordStatus.REDDEDILDI, RecordStatus.YENI,
];
const TRANSITIONS: Record<string, RecordStatus[]> = {
  YENI: [RecordStatus.UZERIME_ALINDI, RecordStatus.DEGERLENDIRILIYOR, RecordStatus.REDDEDILDI, ...ONERI_OUTCOMES],
  UZERIME_ALINDI: FROM_OPEN,
  INCELENIYOR: FROM_OPEN,
  CALISILIYOR: FROM_OPEN,
  EK_BILGI: FROM_OPEN,
  DEGERLENDIRILIYOR: FROM_OPEN,
  COZULDU: [RecordStatus.KAPATILDI, RecordStatus.CALISILIYOR], // yeniden açılabilir
  KAPATILDI: [],
  REDDEDILDI: [],
  DEGERLENDIRILDI: [],
  FAYDA_SAGLADI: [],
  UYGUN_BULUNMADI: [],
};

export function canTransition(from: string, to: string): boolean {
  if (from === to) return true;
  return ((TRANSITIONS[from] ?? []) as string[]).includes(to);
}

export function allowedTransitions(from: string): RecordStatus[] {
  return TRANSITIONS[from] ?? [];
}

/**
 * Anonim kayıtta kimlik gizleme. Saklanır ama sunulmaz — açan kişi ve
 * sistem yöneticisi dışında kimse göremez.
 */
export function maySeeCreator(rec: RecordShape, actor: Actor): boolean {
  if (!rec.anonymous) return true;
  const r = relate(rec, actor);
  return r.isCreator || r.isAdmin;
}
