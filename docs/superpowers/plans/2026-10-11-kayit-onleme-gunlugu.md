# Kayıt Önleme Günlüğü ve Ek Bilgi Akışı — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kayıt önleme oranının dışarıda raporlanabilmesi için yardım oturumlarını, sorguları, gösterilen sonuçları, kayıt adımlarını ve ek bilgi isteklerini PostgreSQL'de ilişkisel tablolarda tutmak; okuma için `rapor` şeması ve salt okunur kullanıcı sağlamak; ek bilgi isteğini gerçek bir akışa dönüştürmek.

**Architecture:** Dört yeni tablo (`HelpSession`, `HelpQuery`, `HelpResult`, `InfoRequest`) ve `RecordEvent`'e tipli kolonlar. Yardım yüzeyleri (`/api/similar`, `/api/search/resources`) sorgu ve sonuçları `src/lib/help-log.ts` üzerinden yazar; oturum ve birleştirme kuralları saf fonksiyonlar olarak `src/domain/help.ts`'te. Kayıt adımlarının tipli kolonları ve ek bilgi isteği/yanıtı/iptali bütün aksiyonların geçtiği `mutate` içinde tek noktada. Rapor katmanı Prisma'nın yönetmediği `rapor` şemasında görünümler.

**Tech Stack:** Fastify 5, Prisma 6.19 (PostgreSQL 17, yerelde gömülü), zod, vitest; ön yüz tek sayfa (`public/index.html`, `api-store.js`, `modules.js`); Windows kurulum betikleri (PowerShell 5.1, UTF-8 BOM).

**Spec:** [docs/superpowers/specs/2026-10-11-kayit-onleme-gunlugu-design.md](../specs/2026-10-11-kayit-onleme-gunlugu-design.md) — §12 plan yazılırken netleşenleri içerir; plan onunla birlikte okunur.

## Global Constraints

- Veritabanı yalnızca PostgreSQL; yeni npm bağımlılığı eklenmez.
- Metinler süresiz saklanır (saklama süresi yok) — spec §1.
- Kısıtlı kayıt ("Yalnızca ilgili ekip görsün"): sorgu metni günlüğe yazılmaz ya da kayıt açılınca silinir; rapor görünümlerinde başlık/açıklama/soru/yanıt/adım metni boş — spec §7.
- Anonim kayıt: oturumun `userId`'si boşaltılır; görünümlerde açan kişi ve onun adımlarındaki kişi boş; `sonraki_*` kolonları anonim kayıtları saymaz — spec §7, §12.
- Tekil oturum: 30 dk hareketsizlik ya da kayıt açılması kapatır; kayıt bağlarken 24 saate kadar geriye bakılır — spec §3.
- Birleştirme: ARAMA 10 sn + önek; ML_TARAMA 60 sn; ASISTAN hiç; sonucuna dokunulmuş sorgu birleşmez — spec §5, §12.
- Ek bilgi beklemesine hedef süre, hatırlatma, otomatik kapanma yok; mevcut SLA'ya dokunulmaz — spec §6.
- Arayüz metinleri Türkçe; kullanıcıya saat/hedef süre vaadi verilmez.
- Kod yorumu yalnızca kodun gösteremediği nedeni, tek satırda, Türkçe yazar; çevredeki kodun biçimine uyulur.
- Göç SQL'i `prisma migrate dev` ile değil, `prisma migrate diff` + elle düzenleme + `prisma migrate deploy` ile üretilir (migrate dev etkileşimli).
- `prisma generate` öncesi yerel sunucu durdurulur (Windows'ta motor dosyası kilitli kalıyor: EPERM).
- Her görev kendi commit'iyle biter; commit mesajı Türkçe, sonunda `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push yapılmaz.
- Üst klasördeki prototip HTML dosyalarına (`ichatlar4.html` vb.) dokunulmaz.

## Review Focus

1. **Yazarken çalışan otomatik tarama ve tuş tuş arama** günlüğü şişirmemeli: aynı taslağın taramaları tek sorgu satırında güncellenmeli (Görev 3 ve 4'te test).
2. **Aynı oturum kimliğiyle eşzamanlı iki kayıt** (çift tıklama, iki sekme): ikisi de 201 açılmalı, ilk bağ ezilmemeli (Görev 6'da test).
3. **Bozuk, başkasının ya da süresi geçmiş oturum kimliği ve var olmayan ekip kimliği** yardımı bozmamalı; yeni oturum açılmalı, ekip boş yazılmalı (Görev 3'te test).
4. **Ek bilgi beklerken ekipten birinin yazdığı güncelleme** yanıt sayılmamalı; yalnızca kaydı açanın güncellemesi yanıttır (Görev 8'de test).
5. **Anonim kayıt** ne günlükten ne rapor görünümlerinden açan kişiye bağlanabilmeli (Görev 6 ve 11'de test).

---

## Dosya Yapısı

| Dosya | Sorumluluk |
|---|---|
| `prisma/schema.prisma` (değişir) | Dört yeni model, `RecordEvent` kolonları, `meta` → `Json` |
| `prisma/migrations/20261011100000_help_log/migration.sql` (yeni) | Tablolar, CHECK, kısmi unique index, `meta` jsonb dönüşümü, geçmiş verinin doldurulması |
| `prisma/migrations/20261011120000_rapor/migration.sql` (yeni) | `rapor` şeması, `rapor.etiket`, görünümler, varsa rapor kullanıcısına yetki |
| `src/domain/help.ts` (yeni) | Kanal/tür/kaynak sabitleri, oturum geçerliliği, birleştirme kuralı (saf) |
| `src/lib/help-log.ts` (yeni) | Oturum aç/sürdür, sorgu+sonuç yaz, kayda bağla (veritabanı) |
| `src/routes/help.ts` (yeni) | `POST /api/help/results/:id` (tıklama, işime yaradı, geri al) |
| `src/domain/info-request.ts` (yeni) | Yanıttan sonra dönülecek durum (saf) |
| `src/routes/records.ts` (değişir) | `/api/similar` günlüğü; kayıt açılışında oturum bağlama; açılış olayının kolonları |
| `src/routes/search.ts` (değişir) | Kaynak Bul günlüğü |
| `src/routes/actions.ts` (değişir) | `mutate`: tipli kolonlar, ek bilgi isteği/yanıtı/iptali; `/info-request` ucu; durum ucunda Ek Bilgi kalkar |
| `src/routes/grants.ts` (değişir) | Devretme olaylarında tipli kolonlar, havuza dönen kayıtta isteğin iptali |
| `src/domain/enums.ts`, `src/domain/permissions.ts`, `src/lib/serialize.ts`, `src/ml/service.ts`, `src/app.ts` (değişir) | Yeni olay/bildirim türleri, `infoRequest` izni, detayda açık istek, jsonb meta okuma, rota kaydı |
| `public/api-store.js`, `public/modules.js`, `public/index.html` (değişir) | Oturum kimliğini taşıma, sonuç etkileşimleri, Ek Bilgi İste / Yanıtla arayüzü |
| `deploy/windows/rapor-kullanicisi.ps1` (yeni), `deploy/windows/kur.ps1` (değişir) | Salt okunur rapor kullanıcısı; kurulum sonunda hatırlatma |
| `docs/RAPOR.md` (yeni), `README.md`, `docs/KURULUM.md` (değişir) | Kolon sözlüğü, örnek sorgular, kurulum adımı |
| `tests/unit/help.test.ts`, `tests/unit/info-request.test.ts`, `tests/integration/help-log.test.ts`, `tests/integration/event-columns.test.ts`, `tests/integration/info-request.test.ts`, `tests/integration/rapor.test.ts` (yeni); `tests/integration/helpers.ts`, `prisma/seed.ts` (değişir) | Testler ve test/tohum temizliği |

Komutlar `ichatlar-app` klasöründe çalıştırılır. Yerel PostgreSQL açık olmalı: `npm run db:local:status` "Çalışıyor" demiyorsa `npm run db:local`.

---

### Task 1: Veri modeli, göç ve jsonb `meta`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261011100000_help_log/migration.sql`
- Modify: `src/routes/actions.ts:112` (meta yazımı), `src/routes/grants.ts:233,247` (meta yazımı), `src/ml/service.ts:108-110` (meta okuma)
- Modify: `tests/integration/helpers.ts` (resetDb), `prisma/seed.ts:79-90` (--reset)
- Test: `tests/integration/event-columns.test.ts` (yeni)

**Interfaces:**
- Produces: Prisma modelleri `HelpSession`, `HelpQuery`, `HelpResult`, `InfoRequest`; `RecordEvent.fromStatus/toStatus/toTeamId/toUserId: string | null`, `RecordEvent.meta: Prisma.JsonValue`. Sonraki bütün görevler bu alan adlarını kullanır.

- [ ] **Step 1: Başarısız testi yaz**

`tests/integration/event-columns.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Role } from '../../src/domain/enums.js';
import { createDept, createRecord, createUser, loginAs, makeApp, prisma, resetDb } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); });
beforeEach(async () => { await resetDb(); });

async function setup() {
  const t = await createDept('Bilgi Teknolojileri');
  const t2 = await createDept('Finans');
  const m = await createUser({ name: 'Üye', role: Role.TEAM_MEMBER, departmentId: t.id });
  const n = await createUser({ name: 'Ekip Arkadaşı', role: Role.TEAM_MEMBER, departmentId: t.id });
  const c = await createUser({ name: 'Açan' });
  const r = await createRecord({ createdById: c.id, departmentId: t.id });
  return { t, t2, m, n, c, r, mH: await loginAs(app, m.id), nH: await loginAs(app, n.id) };
}
const act = (headers: { cookie: string }, code: string, action: string, payload: object = {}) =>
  app.inject({ method: 'POST', url: `/api/records/${code}/${action}`, headers, payload });
const events = (recordId: string) =>
  prisma.recordEvent.findMany({ where: { recordId }, orderBy: [{ at: 'asc' }, { id: 'asc' }] });

describe('kayıt adımları', () => {
  it('olay meta alanı JSON nesnesi olarak saklanır', async () => {
    const { r, mH } = await setup();
    expect((await act(mH, r.code, 'claim')).statusCode).toBe(200);
    expect((await act(mH, r.code, 'status', { status: 'calisiliyor' })).statusCode).toBe(200);
    const ev = await prisma.recordEvent.findFirstOrThrow({ where: { recordId: r.id, type: 'STATUS' } });
    expect(ev.meta).toEqual({ from: 'UZERIME_ALINDI', to: 'CALISILIYOR' });
  });
});
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `npx vitest run tests/integration/event-columns.test.ts`
Expected: FAIL — `meta` metin döner: `'{"from":"UZERIME_ALINDI","to":"CALISILIYOR"}'` nesneye eşit değil.

- [ ] **Step 3: Şemayı değiştir**

`prisma/schema.prisma`:

1. Dosya başındaki açıklamada `JSON alanlar metin olarak saklanır.` satırını şununla değiştir:
   `JSON alanlar metin olarak saklanır; RecordEvent.meta jsonb (rapor sorguları için).`

2. `Department` modelinde `grants Grant[]` satırının altına:

```prisma
  helpSelected  HelpQuery[]   @relation("helpSelectedTeam")
  helpPredicted HelpQuery[]   @relation("helpPredictedTeam")
  eventsTo      RecordEvent[] @relation("eventToTeam")
```

3. `User` modelinde `events RecordEvent[]` satırını `events          RecordEvent[] @relation("eventBy")` yap; `grantsGiven` satırının altına:

```prisma
  eventsTo        RecordEvent[] @relation("eventToUser")
  helpSessions    HelpSession[]
  infoRequested   InfoRequest[] @relation("infoRequester")
  infoAnswered    InfoRequest[] @relation("infoAnswerer")
```

4. `Record` modelinde `notifications Notification[]` satırının altına:

```prisma
  helpSession   HelpSession?
  helpResults   HelpResult[]
  infoRequests  InfoRequest[]
```

5. `RecordEvent` modelini tamamen şununla değiştir:

```prisma
model RecordEvent {
  id String @id @default(cuid())

  recordId String
  record   Record @relation(fields: [recordId], references: [id], onDelete: Cascade)

  /// src/domain/enums.ts → EventType
  type String
  text String
  at   DateTime @default(now())

  /// Sistem olaylarında (SLA ihlali) boş olur.
  byId String?
  by   User?   @relation("eventBy", fields: [byId], references: [id], onDelete: SetNull)

  /// Durum değiştiyse önceki ve sonraki durum (src/routes/actions.ts → mutate).
  fromStatus String?
  toStatus   String?
  /// Açılış ve yönlendirmede hedef ekip; üstlenme ve kişiye devirde hedef kişi.
  toTeamId String?
  toTeam   Department? @relation("eventToTeam", fields: [toTeamId], references: [id], onDelete: SetNull)
  toUserId String?
  toUser   User?       @relation("eventToUser", fields: [toUserId], references: [id], onDelete: SetNull)

  /// Yapısal ek bilgi.
  meta Json?

  attachments Attachment[]
  infoAnswers InfoRequest[]

  @@index([recordId, at])
  @@index([toStatus, at])
}
```

6. `KbArticle` modelinde `active Boolean @default(true)` satırının altına `  helpResults HelpResult[]` ekle.

7. Dosyanın sonuna:

```prisma
// ---------------------------------------------------------------------------
// Kayıt önleme günlüğü (docs/RAPOR.md)
// ---------------------------------------------------------------------------

/// Tekil yardım oturumu: bir kişinin ardışık yardım adımları. 30 dk
/// hareketsizlik ya da kayıt açılması oturumu kapatır (src/domain/help.ts).
/// Kod kolonlarının CHECK kısıtları ve kısmi index'ler migration SQL'inde;
/// `prisma migrate diff` onları bilmez, çıktısında silmeye çalışırsa o
/// satırları göçten çıkarın.
model HelpSession {
  id String @id @default(cuid())

  /// Anonim kayıtta boşaltılır: günlükten kaydı kimin açtığı çıkmasın.
  userId String?
  user   User?   @relation(fields: [userId], references: [id], onDelete: SetNull)

  /// YENI_KAYIT | KAYNAK_BUL | ASISTAN
  channel String

  startedAt      DateTime @default(now())
  lastActivityAt DateTime @default(now())

  /// Bu oturumdan açılan kayıt.
  recordId String? @unique
  record   Record? @relation(fields: [recordId], references: [id], onDelete: SetNull)

  queries HelpQuery[]

  @@index([userId, startedAt])
  @@index([startedAt])
}

/// Oturumdaki ML taraması, Kaynak Bul araması ya da asistan sorusu.
model HelpQuery {
  id String @id @default(cuid())

  sessionId String
  session   HelpSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  at DateTime @default(now())

  /// ML_TARAMA | ARAMA | ASISTAN
  kind String

  /// Kısıtlı kayıtta boş.
  title String?
  text  String?

  /// BILGI | ONERI — yalnızca ML_TARAMA
  recordType String?

  selectedTeamId  String?
  selectedTeam    Department? @relation("helpSelectedTeam", fields: [selectedTeamId], references: [id], onDelete: SetNull)
  predictedTeamId String?
  predictedTeam   Department? @relation("helpPredictedTeam", fields: [predictedTeamId], references: [id], onDelete: SetNull)
  /// 0–1
  confidence      Float?
  lowConfidence   Boolean?

  resultCount Int
  durationMs  Int?

  /// ML veritabanındaki (SQLite) Inference.id — ayrı veritabanı, FK değil.
  mlInferenceId String?

  results HelpResult[]

  @@index([sessionId, at])
  @@index([at])
  @@index([predictedTeamId])
}

/// Sorguda gösterilen sonuç; tıklama ve "işime yaradı" beyanı burada.
model HelpResult {
  id String @id @default(cuid())

  queryId String
  query   HelpQuery @relation(fields: [queryId], references: [id], onDelete: Cascade)

  /// 1'den başlar, ekrandaki sıra.
  rank Int @db.SmallInt

  /// KAYIT | BILGI_BANKASI | CORTEX
  source String

  recordId      String?
  record        Record?    @relation(fields: [recordId], references: [id], onDelete: SetNull)
  kbArticleId   String?
  kbArticle     KbArticle? @relation(fields: [kbArticleId], references: [id], onDelete: SetNull)
  externalUrl   String?
  externalTitle String?

  /// Yüzde, 0–100 (ML eşleşmelerinde).
  similarity Int? @db.SmallInt

  openedAt  DateTime?
  helpfulAt DateTime?

  @@index([queryId])
  @@index([recordId])
  @@index([kbArticleId])
}

/// Ek bilgi isteği: kaydın sahibi açan kişiye soru sorar (src/routes/actions.ts).
/// Kayıt başına en fazla bir açık istek (kısmi unique index, migration'da).
model InfoRequest {
  id String @id @default(cuid())

  recordId String
  record   Record @relation(fields: [recordId], references: [id], onDelete: Cascade)

  requestedById String?
  requestedBy   User?    @relation("infoRequester", fields: [requestedById], references: [id], onDelete: SetNull)
  requestedAt   DateTime @default(now())
  question      String
  /// İstekten önceki durum: yanıt gelince kayıt buna döner (src/domain/info-request.ts).
  statusBefore  String

  answeredById  String?
  answeredBy    User?        @relation("infoAnswerer", fields: [answeredById], references: [id], onDelete: SetNull)
  answeredAt    DateTime?
  answer        String?
  /// Yanıtın ekleri bu olaya bağlı.
  answerEventId String?
  answerEvent   RecordEvent? @relation(fields: [answerEventId], references: [id], onDelete: SetNull)

  /// Yanıt beklenmeden devam edildi (durum değişti, çözüldü, yönlendirildi).
  cancelledAt DateTime?

  @@index([recordId, requestedAt])
}
```

- [ ] **Step 4: Göç SQL'ini üret**

Run:
```bash
mkdir -p prisma/migrations/20261011100000_help_log
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/20261011100000_help_log/migration.sql
```
Expected: dosya `CREATE TABLE "HelpSession"`, `"HelpQuery"`, `"HelpResult"`, `"InfoRequest"`, `ALTER TABLE "RecordEvent"` ve FK'ler içerir.

- [ ] **Step 5: Göç SQL'ini elle düzelt**

1. Üretilen dosyada `RecordEvent` için `DROP COLUMN "meta"` ve `ADD COLUMN "meta" JSONB` geçen satırları bul. Bu, var olan meta verisini siler. `DROP COLUMN "meta",` parçasını ve `ADD COLUMN "meta" JSONB` parçasını o `ALTER TABLE` ifadesinden çıkar (virgülleri düzelt), ve ifadenin hemen ardına şunu ekle:

```sql
-- meta metin → jsonb; veri korunur (değerler toJsonText ile yazılmış geçerli JSON).
ALTER TABLE "RecordEvent" ALTER COLUMN "meta" TYPE JSONB USING "meta"::jsonb;
```

2. Dosyanın sonuna şunu ekle:

```sql
-- Kod kolonları sabit kümelerle sınırlı (Prisma şeması CHECK göstermez).
ALTER TABLE "HelpSession" ADD CONSTRAINT "HelpSession_channel_check"
  CHECK ("channel" IN ('YENI_KAYIT', 'KAYNAK_BUL', 'ASISTAN'));
ALTER TABLE "HelpQuery" ADD CONSTRAINT "HelpQuery_kind_check"
  CHECK ("kind" IN ('ML_TARAMA', 'ARAMA', 'ASISTAN'));
ALTER TABLE "HelpQuery" ADD CONSTRAINT "HelpQuery_recordType_check"
  CHECK ("recordType" IS NULL OR "recordType" IN ('BILGI', 'ONERI'));
ALTER TABLE "HelpQuery" ADD CONSTRAINT "HelpQuery_numbers_check"
  CHECK ("resultCount" >= 0 AND ("durationMs" IS NULL OR "durationMs" >= 0)
     AND ("confidence" IS NULL OR "confidence" BETWEEN 0 AND 1));
ALTER TABLE "HelpResult" ADD CONSTRAINT "HelpResult_source_check"
  CHECK ("source" IN ('KAYIT', 'BILGI_BANKASI', 'CORTEX'));
-- Yalnızca kaynağa uyan hedef kolon dolu olabilir; Cortex bağlantısı boş gelebilir.
ALTER TABLE "HelpResult" ADD CONSTRAINT "HelpResult_target_check"
  CHECK (("source" = 'KAYIT' OR "recordId" IS NULL)
     AND ("source" = 'BILGI_BANKASI' OR "kbArticleId" IS NULL)
     AND ("source" = 'CORTEX' OR ("externalUrl" IS NULL AND "externalTitle" IS NULL)));
ALTER TABLE "HelpResult" ADD CONSTRAINT "HelpResult_numbers_check"
  CHECK ("rank" >= 1 AND ("similarity" IS NULL OR "similarity" BETWEEN 0 AND 100));
ALTER TABLE "InfoRequest" ADD CONSTRAINT "InfoRequest_outcome_check"
  CHECK (NOT ("answeredAt" IS NOT NULL AND "cancelledAt" IS NOT NULL)
     AND ("answeredAt" IS NULL OR "answer" IS NOT NULL));
-- Kayıt başına en fazla bir açık ek bilgi isteği.
CREATE UNIQUE INDEX "InfoRequest_open_key" ON "InfoRequest" ("recordId")
  WHERE "answeredAt" IS NULL AND "cancelledAt" IS NULL;

-- Geçmiş adımlar: meta'dan çıkarılabilenler; çıkarılamayanlar boş kalır.
UPDATE "RecordEvent" SET "fromStatus" = "meta"->>'from', "toStatus" = "meta"->>'to'
WHERE "type" = 'STATUS' AND "meta" ? 'to';
-- upper() tr-TR ICU'da i → İ yapar; eşleme elle.
UPDATE "RecordEvent" SET "toStatus" = CASE "meta"->>'outcome'
    WHEN 'degerlendirildi' THEN 'DEGERLENDIRILDI'
    WHEN 'fayda_sagladi' THEN 'FAYDA_SAGLADI'
    WHEN 'uygun_bulunmadi' THEN 'UYGUN_BULUNMADI' END
WHERE "type" = 'STATUS' AND "meta" ? 'outcome';
UPDATE "RecordEvent" e SET "toTeamId" = e."meta"->>'departmentId'
WHERE e."type" = 'FORWARD'
  AND EXISTS (SELECT 1 FROM "Department" d WHERE d."id" = e."meta"->>'departmentId');
UPDATE "RecordEvent" e SET "toUserId" = COALESCE(e."meta"->>'assigneeId', e."meta"->>'to')
WHERE e."type" = 'FORWARD'
  AND EXISTS (SELECT 1 FROM "User" u WHERE u."id" = COALESCE(e."meta"->>'assigneeId', e."meta"->>'to'));
-- İlk ekip hiçbir yerde saklanmamış: yönlendirilmiş kayıtta bugünkü ekip yanlış olur.
UPDATE "RecordEvent" e SET "toStatus" = 'YENI',
  "toTeamId" = CASE WHEN NOT EXISTS (
      SELECT 1 FROM "RecordEvent" f
      WHERE f."recordId" = e."recordId" AND f."type" = 'FORWARD' AND f."meta" ? 'departmentId'
    ) THEN r."departmentId" END
FROM "Record" r
WHERE r."id" = e."recordId" AND e."type" = 'CREATE';

-- Şu an ek bilgi bekleyen kayıtlar yanıtlanabilsin: açık istek oluşturulur.
INSERT INTO "InfoRequest" ("id", "recordId", "requestedById", "requestedAt", "question", "statusBefore")
SELECT 'ib' || r."id", r."id", e."byId", COALESCE(e."at", r."updatedAt"),
  CASE WHEN position(' — ' IN e."text") > 0
       THEN substring(e."text" FROM position(' — ' IN e."text") + 3)
       ELSE 'Ek bilgi istendi.' END,
  COALESCE(e."meta"->>'from', CASE WHEN r."type" = 'ONERI' THEN 'DEGERLENDIRILIYOR' ELSE 'CALISILIYOR' END)
FROM "Record" r
LEFT JOIN LATERAL (
  SELECT x.* FROM "RecordEvent" x
  WHERE x."recordId" = r."id" AND x."type" = 'STATUS' AND x."meta"->>'to' = 'EK_BILGI'
  ORDER BY x."at" DESC LIMIT 1
) e ON true
WHERE r."status" = 'EK_BILGI';
```

- [ ] **Step 6: Kodu jsonb `meta`'ya uyarla**

`src/routes/actions.ts:112` satırını:
```ts
        ...(planned.event.meta ? { meta: toJsonText(planned.event.meta) } : {}),
```
şununla değiştir:
```ts
        ...(planned.event.meta !== undefined ? { meta: planned.event.meta as Prisma.InputJsonValue } : {}),
```

`src/routes/grants.ts:233` `meta: toJsonText({ handover: true, from: from.id, to: to.id }),` → `meta: { handover: true, from: from.id, to: to.id },`
`src/routes/grants.ts:247` `meta: toJsonText({ handover: true, from: from.id }),` → `meta: { handover: true, from: from.id },`

`src/ml/service.ts:108-110`:
```ts
      corrected: r.events.some(
        (e) => fromJsonText<{ departmentId?: string | null }>(e.meta)?.departmentId,
      ),
```
→
```ts
      corrected: r.events.some((e) => {
        const m = e.meta as { departmentId?: unknown } | null;
        return Boolean(m && typeof m === 'object' && m.departmentId);
      }),
```

- [ ] **Step 7: Test ve tohum temizliğine yeni tabloları ekle**

`tests/integration/helpers.ts` → `resetDb` içinde `assertTestDatabase(...)` satırının hemen altına:
```ts
  await prisma.helpSession.deleteMany();
  await prisma.infoRequest.deleteMany();
```
`prisma/seed.ts` → `--reset` dizisinin başına (`prisma.notification.deleteMany(),` satırından önce):
```ts
    prisma.helpSession.deleteMany(),
    prisma.infoRequest.deleteMany(),
```

- [ ] **Step 8: Göçü uygula, istemciyi üret, sapmayı denetle**

Yerel sunucu açıksa durdur (önizleme `preview_stop` ya da terminalde Ctrl+C). Sonra:
```bash
npx prisma migrate deploy
npm run db:generate
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script
```
Expected: deploy "All migrations have been successfully applied"; son komut `-- This is an empty migration.` yazar. Çıktıda `DROP INDEX "InfoRequest_open_key"` ya da bir `DROP CONSTRAINT ..._check` görünürse bunlar yalnızca Prisma'nın bilmediği nesnelerdir: bir şey yapma, şemadaki `HelpSession` açıklaması bu durumu zaten anlatıyor; plan sonundaki rapora not düş.

Geçmiş verinin dolduğunu denetle:
```bash
npx tsx -e "import { prisma } from './src/db.ts'; console.log(await prisma.\$queryRaw\`SELECT type, count(*)::int n, count(\"toStatus\")::int durum, count(\"toTeamId\")::int ekip, count(\"toUserId\")::int kisi FROM \"RecordEvent\" GROUP BY type ORDER BY type\`); console.log(await prisma.infoRequest.count(), await prisma.record.count({ where: { status: 'EK_BILGI' } })); await prisma.\$disconnect();"
```
Expected: `CREATE` satırında `durum` = `n`; son satırda iki sayı eşit (her ek bilgi bekleyen kayda bir istek).

- [ ] **Step 9: Testleri çalıştır**

Run: `npx vitest run tests/integration/event-columns.test.ts` → PASS.
Run: `npm run typecheck && npm test` → hepsi PASS (önceki 180 test dahil).

- [ ] **Step 10: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261011100000_help_log src/routes/actions.ts src/routes/grants.ts src/ml/service.ts tests/integration/helpers.ts tests/integration/event-columns.test.ts prisma/seed.ts
git commit -m "Veri modeli: yardım oturumu, sorgu, sonuç ve ek bilgi tabloları; olay meta'sı jsonb, geçmiş adımlar dolduruldu

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Yardım oturumu ve birleştirme kuralları (saf)

**Files:**
- Create: `src/domain/help.ts`
- Test: `tests/unit/help.test.ts`

**Interfaces:**
- Produces:
  - `HelpChannel = { YENI_KAYIT, KAYNAK_BUL, ASISTAN }`, `HelpKind = { ML_TARAMA, ARAMA, ASISTAN }`, `HelpSource = { KAYIT, BILGI_BANKASI, CORTEX }` (değer = anahtar, `as const`) ve aynı adlı tipler
  - `SESSION_IDLE_MS = 30 * 60 * 1000`, `LINK_WINDOW_MS = 24 * 60 * 60 * 1000`
  - `sessionUsable(s: SessionState | null, userId: string, now: Date, purpose: 'query' | 'link'): boolean`
  - `shouldMerge(prev: QueryState | null, next: { kind: string; text: string | null }, now: Date): boolean`
  - `interface SessionState { userId: string | null; recordId: string | null; lastActivityAt: Date }`
  - `interface QueryState { kind: string; text: string | null; at: Date; touched: boolean }`

- [ ] **Step 1: Başarısız testi yaz**

`tests/unit/help.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { HelpKind, LINK_WINDOW_MS, SESSION_IDLE_MS, sessionUsable, shouldMerge } from '../../src/domain/help.js';

const now = new Date('2026-10-11T10:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);

describe('yardım oturumu', () => {
  const s = { userId: 'u1', recordId: null, lastActivityAt: ago(SESSION_IDLE_MS - 1000) };

  it('yalnızca sahibinin, kayda bağlanmamış ve süresi geçmemiş oturumu sürer', () => {
    expect(sessionUsable(s, 'u1', now, 'query')).toBe(true);
    expect(sessionUsable(s, 'u2', now, 'query')).toBe(false);
    expect(sessionUsable({ ...s, recordId: 'r1' }, 'u1', now, 'query')).toBe(false);
    expect(sessionUsable({ ...s, userId: null }, 'u1', now, 'query')).toBe(false);
    expect(sessionUsable({ ...s, lastActivityAt: ago(SESSION_IDLE_MS + 1000) }, 'u1', now, 'query')).toBe(false);
    expect(sessionUsable(null, 'u1', now, 'query')).toBe(false);
  });

  it('kayıt bağlarken 24 saate kadar geriye bakar', () => {
    const old = { ...s, lastActivityAt: ago(2 * 60 * 60 * 1000) };
    expect(sessionUsable(old, 'u1', now, 'query')).toBe(false);
    expect(sessionUsable(old, 'u1', now, 'link')).toBe(true);
    expect(sessionUsable({ ...s, lastActivityAt: ago(LINK_WINDOW_MS + 1000) }, 'u1', now, 'link')).toBe(false);
  });
});

describe('sorgu birleştirme', () => {
  const prev = (o: Partial<{ kind: string; text: string | null; at: Date; touched: boolean }> = {}) =>
    ({ kind: HelpKind.ARAMA, text: 'izin', at: ago(5000), touched: false, ...o });

  it('arama: 10 sn içinde ve biri ötekinin önekiyse birleşir (Türkçe harf duyarsız)', () => {
    expect(shouldMerge(prev(), { kind: HelpKind.ARAMA, text: 'izin talebi' }, now)).toBe(true);
    expect(shouldMerge(prev({ text: 'izin talebi' }), { kind: HelpKind.ARAMA, text: 'izin' }, now)).toBe(true);
    expect(shouldMerge(prev(), { kind: HelpKind.ARAMA, text: 'İZİN tal' }, now)).toBe(true);
    expect(shouldMerge(prev(), { kind: HelpKind.ARAMA, text: 'vpn' }, now)).toBe(false);
    expect(shouldMerge(prev({ at: ago(11_000) }), { kind: HelpKind.ARAMA, text: 'izin talebi' }, now)).toBe(false);
  });

  it('ML taraması: 60 sn içinde metin değişse de birleşir', () => {
    const ml = prev({ kind: HelpKind.ML_TARAMA, text: 'VPN kopuyor', at: ago(50_000) });
    expect(shouldMerge(ml, { kind: HelpKind.ML_TARAMA, text: 'Evden VPN bağlantısı kopuyor' }, now)).toBe(true);
    expect(shouldMerge({ ...ml, at: ago(61_000) }, { kind: HelpKind.ML_TARAMA, text: 'x' }, now)).toBe(false);
  });

  it('sonuca dokunulduysa, tür farklıysa, asistan sorusuysa ya da önceki yoksa birleşmez', () => {
    expect(shouldMerge(prev({ touched: true }), { kind: HelpKind.ARAMA, text: 'izin talebi' }, now)).toBe(false);
    expect(shouldMerge(prev(), { kind: HelpKind.ML_TARAMA, text: 'izin' }, now)).toBe(false);
    expect(shouldMerge(prev({ kind: HelpKind.ASISTAN }), { kind: HelpKind.ASISTAN, text: 'izin' }, now)).toBe(false);
    expect(shouldMerge(null, { kind: HelpKind.ARAMA, text: 'izin' }, now)).toBe(false);
  });
});
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `npx vitest run tests/unit/help.test.ts`
Expected: FAIL — `Cannot find module '../../src/domain/help.js'`.

- [ ] **Step 3: Kuralları yaz**

`src/domain/help.ts`:

```ts
import { fold } from './similarity.js';

/**
 * Kayıt önleme günlüğünün kuralları (docs/superpowers/specs/2026-10-11-kayit-onleme-gunlugu-design.md §3, §5).
 * Veritabanına dokunmaz; yazımı src/lib/help-log.ts yapar.
 */

export const HelpChannel = { YENI_KAYIT: 'YENI_KAYIT', KAYNAK_BUL: 'KAYNAK_BUL', ASISTAN: 'ASISTAN' } as const;
export type HelpChannel = (typeof HelpChannel)[keyof typeof HelpChannel];

export const HelpKind = { ML_TARAMA: 'ML_TARAMA', ARAMA: 'ARAMA', ASISTAN: 'ASISTAN' } as const;
export type HelpKind = (typeof HelpKind)[keyof typeof HelpKind];

export const HelpSource = { KAYIT: 'KAYIT', BILGI_BANKASI: 'BILGI_BANKASI', CORTEX: 'CORTEX' } as const;
export type HelpSource = (typeof HelpSource)[keyof typeof HelpSource];

/** Web analitiğindeki olağan oturum sınırı. */
export const SESSION_IDLE_MS = 30 * 60 * 1000;
/** Taramadan sonra formu uzun süre yazan kişinin kaydı yine o oturuma bağlansın. */
export const LINK_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Arama her tuşta, ML taraması her 0,9 sn duraklamada çalışıyor; asistan sorusu hiç birleşmez. */
const MERGE_MS: Partial<Record<string, number>> = { [HelpKind.ARAMA]: 10_000, [HelpKind.ML_TARAMA]: 60_000 };

export interface SessionState { userId: string | null; recordId: string | null; lastActivityAt: Date }
export interface QueryState { kind: string; text: string | null; at: Date; touched: boolean }

export function sessionUsable(s: SessionState | null, userId: string, now: Date, purpose: 'query' | 'link'): boolean {
  if (!s || s.userId !== userId || s.recordId) return false;
  const limit = purpose === 'link' ? LINK_WINDOW_MS : SESSION_IDLE_MS;
  return now.getTime() - s.lastActivityAt.getTime() <= limit;
}

/** Yeni sorgu öncekinin devamı mı (aynı taslağın yeni hâli): öyleyse yeni satır açılmaz. */
export function shouldMerge(prev: QueryState | null, next: { kind: string; text: string | null }, now: Date): boolean {
  if (!prev || prev.touched || prev.kind !== next.kind) return false;
  const window = MERGE_MS[next.kind];
  if (!window || now.getTime() - prev.at.getTime() > window) return false;
  if (next.kind !== HelpKind.ARAMA) return true;
  const a = fold(prev.text ?? '');
  const b = fold(next.text ?? '');
  return a.startsWith(b) || b.startsWith(a);
}
```

- [ ] **Step 4: Testi çalıştır**

Run: `npx vitest run tests/unit/help.test.ts`
Expected: PASS (4 test).

- [ ] **Step 5: Commit**

```bash
git add src/domain/help.ts tests/unit/help.test.ts
git commit -m "Yardım oturumu ve sorgu birleştirme kuralları

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Yardım günlüğü servisi ve `/api/similar`

**Files:**
- Create: `src/lib/help-log.ts`
- Modify: `src/routes/records.ts:193-255` (`/api/similar`)
- Test: `tests/integration/help-log.test.ts` (yeni)

**Interfaces:**
- Consumes: Task 2'deki `HelpChannel`, `HelpKind`, `HelpSource`, `sessionUsable`, `shouldMerge`.
- Produces:
  - `openSession(db: Db, userId: string, sessionId: string | null, channel: HelpChannel, now: Date, purpose: 'query' | 'link'): Promise<string>`
  - `logHelpQuery(log: FastifyBaseLogger, q: HelpQueryInput): Promise<{ sessionId: string; resultIds: string[] } | null>` — yazamazsa `null`, yardım yine döner
  - `interface HelpHit { source: HelpSource; code?: string | null; url?: string | null; title?: string | null; similarity?: number | null }` — KAYIT'ta kayıt kodu, BILGI_BANKASI'nda `"BB-<seq>"`
  - `interface HelpQueryInput { userId; sessionId?; channel; kind; title?; text?; recordType?: 'BILGI' | 'ONERI' | null; selectedTeamId?; predictedTeamId?; confidence?; lowConfidence?; durationMs?; mlInferenceId?; hits: HelpHit[] }`
  - `/api/similar` gövdesi: `helpSessionId?`, `channel: 'YENI_KAYIT' | 'ASISTAN'` (varsayılan YENI_KAYIT), `limit: 1..3` (varsayılan 3); yanıt: `helpSessionId: string | null`, her eşleşmede `resultId: string | null`.

- [ ] **Step 1: Başarısız testi yaz**

`tests/integration/help-log.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { RecordStatus } from '../../src/domain/enums.js';
import { createDept, createRecord, createUser, loginAs, makeApp, prisma, resetDb } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); });
beforeEach(async () => { await resetDb(); });

type Headers = { cookie: string };

async function setup() {
  const bt = await createDept('Bilgi Teknolojileri');
  const u = await createUser({ name: 'Çalışan' });
  const other = await createUser({ name: 'Başkası' });
  await createRecord({
    createdById: other.id, departmentId: bt.id, status: RecordStatus.KAPATILDI,
    title: 'VPN bağlantısı sürekli kopuyor', resolution: 'VPN istemcisini güncelleyip bilgisayarı yeniden başlatın.',
  });
  return { bt, u, other, headers: await loginAs(app, u.id), otherHeaders: await loginAs(app, other.id) };
}
const scan = (headers: Headers, extra: object = {}) =>
  app.inject({
    method: 'POST', url: '/api/similar', headers,
    payload: { title: 'VPN bağlantısı kopuyor', description: 'Evden çalışırken VPN bağlantısı sık sık kopuyor.', type: 'bilgi', ...extra },
  });

describe('yardım günlüğü: ML taraması', () => {
  it('tarama oturum, sorgu ve gösterilen sonuçları yazar', async () => {
    const { bt, u, headers } = await setup();
    const res = await scan(headers, { department: bt.id });
    expect(res.statusCode).toBe(200);
    const out = res.json();
    expect(out.helpSessionId).toBeTruthy();
    expect(out.matches.length).toBeGreaterThan(0);
    expect(out.matches[0].resultId).toBeTruthy();

    const s = await prisma.helpSession.findUniqueOrThrow({
      where: { id: out.helpSessionId },
      include: { queries: { include: { results: { orderBy: { rank: 'asc' } } } } },
    });
    expect(s).toMatchObject({ userId: u.id, channel: 'YENI_KAYIT', recordId: null });
    expect(s.queries).toHaveLength(1);
    expect(s.queries[0]).toMatchObject({
      kind: 'ML_TARAMA', title: 'VPN bağlantısı kopuyor', recordType: 'BILGI',
      selectedTeamId: bt.id, resultCount: out.matches.length,
    });
    expect(s.queries[0]!.results[0]).toMatchObject({ id: out.matches[0].resultId, rank: 1, source: 'KAYIT' });
    expect(s.queries[0]!.results[0]!.recordId).toBeTruthy();
  });

  it('yazarken art arda gelen taramalar tek sorguda birleşir; sonuca dokunulunca yenisi açılır', async () => {
    const { headers } = await setup();
    const first = (await scan(headers)).json();
    const second = (await scan(headers, { helpSessionId: first.helpSessionId, title: 'VPN bağlantısı kopuyor evde' })).json();
    expect(second.helpSessionId).toBe(first.helpSessionId);
    const qs = await prisma.helpQuery.findMany({ where: { sessionId: first.helpSessionId } });
    expect(qs).toHaveLength(1);
    expect(qs[0]!.title).toBe('VPN bağlantısı kopuyor evde');

    await prisma.helpResult.update({ where: { id: second.matches[0].resultId }, data: { openedAt: new Date() } });
    await scan(headers, { helpSessionId: first.helpSessionId });
    expect(await prisma.helpQuery.count({ where: { sessionId: first.helpSessionId } })).toBe(2);
  });

  it('başkasının ya da süresi geçmiş oturum kimliği yeni oturum açar', async () => {
    const { headers, otherHeaders } = await setup();
    const mine = (await scan(headers)).json();
    const theirs = (await scan(otherHeaders, { helpSessionId: mine.helpSessionId })).json();
    expect(theirs.helpSessionId).not.toBe(mine.helpSessionId);

    await prisma.helpSession.update({
      where: { id: mine.helpSessionId }, data: { lastActivityAt: new Date(Date.now() - 31 * 60 * 1000) },
    });
    const later = (await scan(headers, { helpSessionId: mine.helpSessionId })).json();
    expect(later.helpSessionId).not.toBe(mine.helpSessionId);
  });

  it('bozuk oturum ve var olmayan ekip kimliği yardımı engellemez', async () => {
    const { headers } = await setup();
    const res = await scan(headers, { department: 'yok-boyle-ekip', helpSessionId: 'x'.repeat(40) });
    expect(res.statusCode).toBe(200);
    const out = res.json();
    expect(out.matches.length).toBeGreaterThan(0);
    const q = await prisma.helpQuery.findFirstOrThrow({ where: { sessionId: out.helpSessionId } });
    expect(q.selectedTeamId).toBeNull();
  });

  it('kısıtlı taslağın metni günlüğe yazılmaz', async () => {
    const { headers } = await setup();
    const out = (await scan(headers, { restricted: true })).json();
    const q = await prisma.helpQuery.findFirstOrThrow({ where: { sessionId: out.helpSessionId } });
    expect(q.title).toBeNull();
    expect(q.text).toBeNull();
    expect(q.resultCount).toBe(out.matches.length);
  });

  it('asistan sorusu tek sonuçla ASISTAN olarak yazılır ve birleşmez', async () => {
    const { headers } = await setup();
    const ask = (extra: object = {}) => scan(headers, { channel: 'ASISTAN', limit: 1, description: '', type: undefined, ...extra });
    const a = (await ask()).json();
    expect(a.matches.length).toBeLessThanOrEqual(1);
    await ask({ helpSessionId: a.helpSessionId });
    const qs = await prisma.helpQuery.findMany({ where: { sessionId: a.helpSessionId } });
    expect(qs).toHaveLength(2);
    expect(qs.every((q) => q.kind === 'ASISTAN' && q.title === null && q.text === 'VPN bağlantısı kopuyor')).toBe(true);
    expect((await prisma.helpSession.findUniqueOrThrow({ where: { id: a.helpSessionId } })).channel).toBe('ASISTAN');
  });
});
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `npx vitest run tests/integration/help-log.test.ts`
Expected: FAIL — yanıtta `helpSessionId` yok (`undefined`).

- [ ] **Step 3: Günlük servisini yaz**

`src/lib/help-log.ts`:

```ts
import type { Prisma, PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { prisma } from '../db.js';
import { HelpChannel, HelpKind, HelpSource, sessionUsable, shouldMerge } from '../domain/help.js';

/**
 * Kayıt önleme günlüğünün yazımı (docs/RAPOR.md). Günlük yardımın kendisini
 * bozmaz: yazılamazsa uyarı düşülür, çağıran sonuçları yine döner.
 */

type Db = Prisma.TransactionClient | PrismaClient;

export interface HelpHit {
  source: HelpSource;
  /** KAYIT: kayıt kodu; BILGI_BANKASI: "BB-<seq>". */
  code?: string | null;
  url?: string | null;
  title?: string | null;
  similarity?: number | null;
}

export interface HelpQueryInput {
  userId: string;
  sessionId?: string | null;
  channel: HelpChannel;
  kind: HelpKind;
  title?: string | null;
  text?: string | null;
  recordType?: 'BILGI' | 'ONERI' | null;
  selectedTeamId?: string | null;
  predictedTeamId?: string | null;
  confidence?: number | null;
  lowConfidence?: boolean | null;
  durationMs?: number | null;
  mlInferenceId?: string | null;
  hits: HelpHit[];
}

/** Gelen oturum sürdürülebilirse onu, değilse yeni bir oturumun kimliğini döner. */
export async function openSession(
  db: Db, userId: string, sessionId: string | null, channel: HelpChannel, now: Date, purpose: 'query' | 'link',
): Promise<string> {
  if (sessionId) {
    const s = await db.helpSession.findUnique({
      where: { id: sessionId }, select: { userId: true, recordId: true, lastActivityAt: true },
    });
    if (sessionUsable(s, userId, now, purpose)) return sessionId;
  }
  const created = await db.helpSession.create({
    data: { userId, channel, startedAt: now, lastActivityAt: now }, select: { id: true },
  });
  return created.id;
}

/** Sonuçların hedef kolonları (kayıt / madde kimliği ya da dış bağlantı), hits ile aynı sırada. */
async function resolveTargets(db: Db, hits: HelpHit[]) {
  const codes = hits.filter((h) => h.source === HelpSource.KAYIT && h.code).map((h) => h.code!);
  const seqs = hits
    .filter((h) => h.source === HelpSource.BILGI_BANKASI && h.code)
    .map((h) => Number(h.code!.replace(/^BB-/, '')))
    .filter(Number.isInteger);
  const recs = codes.length ? await db.record.findMany({ where: { code: { in: codes } }, select: { id: true, code: true } }) : [];
  const kbs = seqs.length ? await db.kbArticle.findMany({ where: { seq: { in: seqs } }, select: { id: true, seq: true } }) : [];
  const recId = new Map(recs.map((r) => [r.code, r.id]));
  const kbId = new Map(kbs.map((k) => [`BB-${k.seq}`, k.id]));
  return hits.map((h) => ({
    recordId: h.source === HelpSource.KAYIT ? recId.get(h.code ?? '') ?? null : null,
    kbArticleId: h.source === HelpSource.BILGI_BANKASI ? kbId.get(h.code ?? '') ?? null : null,
    externalUrl: h.source === HelpSource.CORTEX ? h.url ?? null : null,
    externalTitle: h.source === HelpSource.CORTEX ? h.title ?? null : null,
  }));
}

export async function logHelpQuery(
  log: FastifyBaseLogger, q: HelpQueryInput,
): Promise<{ sessionId: string; resultIds: string[] } | null> {
  try {
    return await prisma.$transaction(async (tx) => {
      const now = new Date();
      const sessionId = await openSession(tx, q.userId, q.sessionId ?? null, q.channel, now, 'query');

      // Formdan gelen ekip kimliği doğrulanmamış girdi: yoksa boş yazılır (FK).
      const teamIds = [q.selectedTeamId, q.predictedTeamId].filter((x): x is string => Boolean(x));
      const known = new Set(
        teamIds.length
          ? (await tx.department.findMany({ where: { id: { in: teamIds } }, select: { id: true } })).map((d) => d.id)
          : [],
      );

      const prev = await tx.helpQuery.findFirst({
        where: { sessionId },
        orderBy: { at: 'desc' },
        select: {
          id: true, kind: true, text: true, at: true,
          results: { where: { OR: [{ openedAt: { not: null } }, { helpfulAt: { not: null } }] }, select: { id: true }, take: 1 },
        },
      });
      const merge = shouldMerge(
        prev && { kind: prev.kind, text: prev.text, at: prev.at, touched: prev.results.length > 0 },
        { kind: q.kind, text: q.text ?? null },
        now,
      );

      const data = {
        at: now,
        kind: q.kind,
        title: q.title ?? null,
        text: q.text ?? null,
        recordType: q.recordType ?? null,
        selectedTeamId: q.selectedTeamId && known.has(q.selectedTeamId) ? q.selectedTeamId : null,
        predictedTeamId: q.predictedTeamId && known.has(q.predictedTeamId) ? q.predictedTeamId : null,
        confidence: q.confidence ?? null,
        lowConfidence: q.lowConfidence ?? null,
        resultCount: q.hits.length,
        durationMs: q.durationMs == null ? null : Math.round(q.durationMs),
        mlInferenceId: q.mlInferenceId ?? null,
      };

      let queryId: string;
      if (merge && prev) {
        await tx.helpResult.deleteMany({ where: { queryId: prev.id } });
        await tx.helpQuery.update({ where: { id: prev.id }, data });
        queryId = prev.id;
      } else {
        queryId = (await tx.helpQuery.create({ data: { ...data, sessionId }, select: { id: true } })).id;
      }

      const targets = await resolveTargets(tx, q.hits);
      const resultIds: string[] = [];
      for (const [i, h] of q.hits.entries()) {
        const r = await tx.helpResult.create({
          data: { queryId, rank: i + 1, source: h.source, ...targets[i]!, similarity: h.similarity ?? null },
          select: { id: true },
        });
        resultIds.push(r.id);
      }
      await tx.helpSession.update({ where: { id: sessionId }, data: { lastActivityAt: now } });
      return { sessionId, resultIds };
    });
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'yardım günlüğü yazılamadı');
    return null;
  }
}
```

- [ ] **Step 4: `/api/similar`'ı günlüğe bağla**

`src/routes/records.ts` içe aktarmalarına ekle:
```ts
import { logHelpQuery } from '../lib/help-log.js';
import { HelpChannel, HelpKind, HelpSource } from '../domain/help.js';
```

`app.post('/api/similar', ...)` rotasının gövde şemasında `restricted: z.boolean().default(false),` satırının altına ekle:
```ts
        /** Yardım oturumu (kayıt önleme günlüğü); boşsa ya da geçersizse yenisi açılır. */
        helpSessionId: z.string().max(64).nullish(),
        channel: z.enum([HelpChannel.YENI_KAYIT, HelpChannel.ASISTAN]).default(HelpChannel.YENI_KAYIT),
        /** Asistan tek sonuç gösterir; günlüğe yalnızca gösterilen yazılsın. */
        limit: z.number().int().min(1).max(3).default(3),
```

`findSimilar(..., 3,)` çağrısındaki `3`'ü `body.data.limit` yap.

`const inferenceId = body.data.restricted ? null : await logInference(req.log, {` satırından hemen önce:
```ts
    const durationMs = performance.now() - t0;
```
ve `logInference` çağrısındaki `durationMs: performance.now() - t0,` satırını `durationMs,` yap.

`return {` satırından önce:
```ts
    const asistan = body.data.channel === HelpChannel.ASISTAN;
    const top = suggestion?.candidates[0];
    const help = await logHelpQuery(req.log, {
      userId: actor.id,
      sessionId: body.data.helpSessionId ?? null,
      channel: body.data.channel,
      kind: asistan ? HelpKind.ASISTAN : HelpKind.ML_TARAMA,
      // Kısıtlı taslağın metni günlüğe de yazılmaz (ML veritabanındaki kuralla aynı).
      title: body.data.restricted || asistan ? null : body.data.title,
      text: body.data.restricted ? null : asistan ? body.data.title : body.data.description,
      recordType: !asistan && body.data.type ? TYPE_FROM_SLUG[body.data.type]! : null,
      selectedTeamId: body.data.department ?? null,
      predictedTeamId: top?.departmentId ?? null,
      confidence: top ? top.probability : null,
      lowConfidence: suggestion ? suggestion.lowConfidence : null,
      durationMs,
      mlInferenceId: inferenceId,
      hits: matches.map((m) => ({
        source: m.source === 'kb' ? HelpSource.BILGI_BANKASI : HelpSource.KAYIT,
        code: m.code,
        similarity: m.percent,
      })),
    });
```
ve dönen nesnede `matches,` satırını şununla değiştir:
```ts
      matches: matches.map((m, i) => ({ ...m, resultId: help?.resultIds[i] ?? null })),
      helpSessionId: help?.sessionId ?? null,
```

- [ ] **Step 5: Testleri çalıştır**

Run: `npx vitest run tests/integration/help-log.test.ts tests/integration/ml-drafts.test.ts`
Expected: PASS (6 + 3 test).

- [ ] **Step 6: Commit**

```bash
git add src/lib/help-log.ts src/routes/records.ts tests/integration/help-log.test.ts
git commit -m "Kayıt önleme günlüğü: ML taraması ve asistan sorusu oturum, sorgu ve sonuç olarak yazılır

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Kaynak Bul günlüğü

**Files:**
- Modify: `src/routes/search.ts`
- Test: `tests/integration/help-log.test.ts` (yeni `describe` bloğu)

**Interfaces:**
- Consumes: Task 3 `logHelpQuery`, `HelpHit`; Task 2 `HelpChannel.KAYNAK_BUL`, `HelpKind.ARAMA`, `HelpSource`.
- Produces: `GET /api/search/resources?q&helpSessionId` → `helpSessionId: string | null` ve her öğede `resultId: string | null`. Boş sorguda (`sample: true`) günlük yazılmaz, `helpSessionId` alanı dönmez.

- [ ] **Step 1: Başarısız testi ekle**

`tests/integration/help-log.test.ts` sonuna:

```ts
describe('yardım günlüğü: Kaynak Bul', () => {
  async function searchSetup() {
    const base = await setup();
    await prisma.kbArticle.create({
      data: {
        departmentId: base.bt.id, kind: 'BILGI', title: 'VPN kurulumu', keywords: 'vpn uzaktan erişim',
        answer: 'VPN istemcisini Yazılım Merkezi üzerinden kurun.',
      },
    });
    const search = (q: string, sid?: string) =>
      app.inject({
        method: 'GET', headers: base.headers,
        url: '/api/search/resources?' + new URLSearchParams({ q, ...(sid ? { helpSessionId: sid } : {}) }),
      });
    return { ...base, search };
  }

  it('arama sorgusu ve sonuçları kaynaklarıyla yazılır', async () => {
    const { search } = await searchSetup();
    const out = (await search('vpn')).json();
    expect(out.helpSessionId).toBeTruthy();
    expect(out.items.length).toBeGreaterThan(0);
    expect(out.items.every((x: { resultId: string | null }) => x.resultId)).toBe(true);
    const q = await prisma.helpQuery.findFirstOrThrow({
      where: { sessionId: out.helpSessionId }, include: { results: { orderBy: { rank: 'asc' } } },
    });
    expect(q).toMatchObject({ kind: 'ARAMA', text: 'vpn', title: null, resultCount: out.items.length });
    const kb = q.results.find((r) => r.source === 'BILGI_BANKASI');
    expect(kb?.kbArticleId).toBeTruthy();
    expect((await prisma.helpSession.findUniqueOrThrow({ where: { id: out.helpSessionId } })).channel).toBe('KAYNAK_BUL');
  });

  it('yazarken uzayan arama tek sorgu, yeni konu yeni sorgu', async () => {
    const { search } = await searchSetup();
    const a = (await search('vpn')).json();
    await search('vpn kur', a.helpSessionId);
    const qs = await prisma.helpQuery.findMany({ where: { sessionId: a.helpSessionId } });
    expect(qs).toHaveLength(1);
    expect(qs[0]!.text).toBe('vpn kur');
    await search('izin', a.helpSessionId);
    expect(await prisma.helpQuery.count({ where: { sessionId: a.helpSessionId } })).toBe(2);
  });

  it('boş arama günlüğe yazılmaz', async () => {
    const { search } = await searchSetup();
    const out = (await search('')).json();
    expect(out.sample).toBe(true);
    expect(out.helpSessionId ?? null).toBeNull();
    expect(await prisma.helpQuery.count()).toBe(0);
  });
});
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `npx vitest run tests/integration/help-log.test.ts -t "Kaynak Bul"`
Expected: FAIL — `helpSessionId` yok.

- [ ] **Step 3: Arama ucunu değiştir**

`src/routes/search.ts`:

İçe aktarmalara:
```ts
import { actorOf, requireUser } from '../auth/guard.js';
import { HelpChannel, HelpKind, HelpSource } from '../domain/help.js';
import { logHelpQuery, type HelpHit } from '../lib/help-log.js';
```
(var olan `import { requireUser } from '../auth/guard.js';` satırı bununla değişir.)

Sorgu şeması:
```ts
const query = z.object({
  q: z.string().trim().max(120).default(''),
  /** Yardım oturumu (kayıt önleme günlüğü). */
  helpSessionId: z.string().max(64).optional(),
});
```

`const kbHits = kb ... .map((x) => kbView(x.a));` zincirini ikiye böl:
```ts
    const kbTop = kb
      .map((a) => {
        const head = tokenize(`${a.title} ${a.keywords ?? ''}`);
        const body = tokenize(a.answer);
        let score = 0;
        for (const t of new Set(head)) if (qTokens.has(t)) score += 2;
        for (const t of new Set(body)) if (qTokens.has(t)) score += 0.5;
        if (fold(a.title).includes(fq)) score += 3;
        return { a, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((x) => x.a);
    const kbHits = kbTop.map(kbView);
```

`const recordHits = similar.filter(...).map(...)` zincirini ikiye böl — süzülen eşleşmeler ayrı tutulur:
```ts
    const recordTop = similar.filter((m) => {
      const key = fold(m.title) + '|' + fold(m.resolution);
      if (seen.has(key) || seen.has(fold(m.title))) return false;
      seen.add(key);
      return true;
    });
    const recordHits = recordTop.map((m) => ({
      source: 'kayit' as const,
      kind: 'KAYIT',
      kindLabel: 'Çözülmüş kayıt',
      title: m.title,
      text: m.resolution,
      url: null,
      department: m.departmentName,
    }));
```

Son `return` satırını şununla değiştir:
```ts
    const items = [...kbHits, ...cortexHits, ...recordHits];
    // Günlük, ekrandaki sırayla aynı: önce Bilgi Bankası, sonra Cortex, sonra kayıtlar.
    const hits: HelpHit[] = [
      ...kbTop.map((a) => ({ source: HelpSource.BILGI_BANKASI, code: `BB-${a.seq}` })),
      ...cortex.items.map((c) => ({ source: HelpSource.CORTEX, url: c.url, title: c.title })),
      ...recordTop.map((m) => ({ source: HelpSource.KAYIT, code: m.code, similarity: m.percent })),
    ];
    const help = await logHelpQuery(req.log, {
      userId: actorOf(req).id,
      sessionId: p.data.helpSessionId ?? null,
      channel: HelpChannel.KAYNAK_BUL,
      kind: HelpKind.ARAMA,
      text: q,
      hits,
    });
    return {
      items: items.map((x, i) => ({ ...x, resultId: help?.resultIds[i] ?? null })),
      helpSessionId: help?.sessionId ?? null,
      sample: false,
      sources: { cortex: cortex.status },
    };
```

- [ ] **Step 4: Testleri çalıştır**

Run: `npx vitest run tests/integration/help-log.test.ts tests/integration/modules.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/search.ts tests/integration/help-log.test.ts
git commit -m "Kayıt önleme günlüğü: Kaynak Bul aramaları ve sonuçları yazılır, yazarken uzayan arama tek sorgu

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Sonuç etkileşimi ucu

**Files:**
- Create: `src/routes/help.ts`
- Modify: `src/app.ts` (rota kaydı)
- Test: `tests/integration/help-log.test.ts` (yeni `describe`)

**Interfaces:**
- Produces: `POST /api/help/results/:id` gövde `{ action: 'open' | 'helpful' | 'unhelpful' }` → 204. `open` yalnızca ilk tıklamayı yazar; `helpful` `helpfulAt = now`; `unhelpful` `helpfulAt = null`; sonuç başkasının oturumundaysa ya da yoksa 404; geçersiz gövde 400. Oturumun `lastActivityAt`'i güncellenir.

- [ ] **Step 1: Başarısız testi ekle**

`tests/integration/help-log.test.ts` sonuna:

```ts
describe('yardım günlüğü: sonuç etkileşimi', () => {
  it('bağlantı tıklaması bir kez; işime yaradı ve geri alma yazılır', async () => {
    const { headers } = await setup();
    const out = (await scan(headers)).json();
    const rid = out.matches[0].resultId as string;
    const hit = (action: string) =>
      app.inject({ method: 'POST', url: `/api/help/results/${rid}`, headers, payload: { action } });
    const row = () => prisma.helpResult.findUniqueOrThrow({ where: { id: rid } });

    expect((await hit('open')).statusCode).toBe(204);
    const opened = (await row()).openedAt;
    expect(opened).toBeTruthy();
    await hit('open');
    expect((await row()).openedAt).toEqual(opened);

    expect((await hit('helpful')).statusCode).toBe(204);
    expect((await row()).helpfulAt).toBeTruthy();
    expect((await hit('unhelpful')).statusCode).toBe(204);
    expect((await row()).helpfulAt).toBeNull();
  });

  it('başkasının sonucu 404, geçersiz eylem 400', async () => {
    const { headers, otherHeaders } = await setup();
    const rid = (await scan(headers)).json().matches[0].resultId as string;
    const res = await app.inject({ method: 'POST', url: `/api/help/results/${rid}`, headers: otherHeaders, payload: { action: 'helpful' } });
    expect(res.statusCode).toBe(404);
    const bad = await app.inject({ method: 'POST', url: `/api/help/results/${rid}`, headers, payload: { action: 'sil' } });
    expect(bad.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `npx vitest run tests/integration/help-log.test.ts -t "sonuç etkileşimi"`
Expected: FAIL — 404 (rota yok).

- [ ] **Step 3: Rotayı yaz**

`src/routes/help.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { actorOf, requireUser } from '../auth/guard.js';
import { badRequest, notFound } from '../lib/errors.js';

/**
 * Yardım sonucuyla etkileşim (kayıt önleme günlüğü): bağlantıya tıklama,
 * "Bu çözüm işime yaradı" ve geri alınması. Yalnızca sonucu kendi
 * oturumunda olan kişi yazabilir.
 */
const body = z.object({ action: z.enum(['open', 'helpful', 'unhelpful']) });

export default async function helpRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  app.post('/api/help/results/:id', async (req, reply) => {
    const parsed = body.safeParse(req.body);
    if (!parsed.success) throw badRequest('Geçersiz istek.');
    const { id } = req.params as { id: string };
    const actor = actorOf(req);

    const r = await prisma.helpResult.findUnique({
      where: { id },
      select: { openedAt: true, query: { select: { sessionId: true, session: { select: { userId: true } } } } },
    });
    if (!r || r.query.session.userId !== actor.id) throw notFound('Sonuç');

    const now = new Date();
    const action = parsed.data.action;
    const data =
      action === 'open' ? (r.openedAt ? null : { openedAt: now })
        : { helpfulAt: action === 'helpful' ? now : null };
    await prisma.$transaction([
      ...(data ? [prisma.helpResult.update({ where: { id }, data })] : []),
      prisma.helpSession.update({ where: { id: r.query.sessionId }, data: { lastActivityAt: now } }),
    ]);
    reply.code(204);
  });
}
```

`src/app.ts`: içe aktarmalara `import helpRoutes from './routes/help.js';`, `await app.register(searchRoutes);` satırının altına `await app.register(helpRoutes);`.

- [ ] **Step 4: Testleri çalıştır**

Run: `npx vitest run tests/integration/help-log.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/help.ts src/app.ts tests/integration/help-log.test.ts
git commit -m "Yardım sonucuna tıklama, işime yaradı ve geri alma ucu

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Kayıt açılışında oturum bağlama ve açılış olayının kolonları

**Files:**
- Modify: `src/lib/help-log.ts` (`linkHelpSession`)
- Modify: `src/routes/records.ts` (`createBody`, `POST /api/records`)
- Test: `tests/integration/help-log.test.ts` (yeni `describe`)

**Interfaces:**
- Consumes: Task 3 `openSession`.
- Produces: `linkHelpSession(log, { userId, sessionId: string | null, recordId, anonymous: boolean, restricted: boolean }): Promise<void>` (hata yutar); `POST /api/records` gövdesinde `helpSessionId?: string | null`.

- [ ] **Step 1: Başarısız testi ekle**

`tests/integration/help-log.test.ts` sonuna:

```ts
describe('kayıt açılışında yardım oturumu', () => {
  const create = (headers: Headers, extra: object = {}) =>
    app.inject({
      method: 'POST', url: '/api/records', headers,
      payload: { type: 'bilgi', title: 'VPN bağlantısı kopuyor', description: 'Evden çalışırken VPN bağlantısı sık sık kopuyor.', ...extra },
    });
  const recordOf = async (res: { json(): { record: { code: string } } }) =>
    prisma.record.findUniqueOrThrow({ where: { code: res.json().record.code } });

  it('taramanın oturumu kayda bağlanır', async () => {
    const { bt, headers } = await setup();
    const s = (await scan(headers)).json();
    const res = await create(headers, { department: bt.id, helpSessionId: s.helpSessionId });
    expect(res.statusCode).toBe(201);
    const rec = await recordOf(res);
    expect((await prisma.helpSession.findUniqueOrThrow({ where: { id: s.helpSessionId } })).recordId).toBe(rec.id);
  });

  it('taramasız kayıt sorgusuz bir oturuma bağlanır', async () => {
    const { bt, u, headers } = await setup();
    const rec = await recordOf(await create(headers, { department: bt.id }));
    const s = await prisma.helpSession.findUniqueOrThrow({ where: { recordId: rec.id }, include: { queries: true } });
    expect(s).toMatchObject({ userId: u.id, channel: 'YENI_KAYIT' });
    expect(s.queries).toHaveLength(0);
  });

  it('anonim kayıtta oturumun kişisi, kısıtlıda sorgu metinleri silinir', async () => {
    const { bt, headers } = await setup();
    const a = (await scan(headers)).json();
    await create(headers, { department: bt.id, helpSessionId: a.helpSessionId, anonymous: true });
    expect((await prisma.helpSession.findUniqueOrThrow({ where: { id: a.helpSessionId } })).userId).toBeNull();

    const b = (await scan(headers)).json();
    await create(headers, { department: bt.id, helpSessionId: b.helpSessionId, restricted: true });
    const q = await prisma.helpQuery.findFirstOrThrow({ where: { sessionId: b.helpSessionId } });
    expect(q.title).toBeNull();
    expect(q.text).toBeNull();
  });

  it('aynı oturumla eşzamanlı iki kayıt da açılır; oturum yalnızca birine bağlanır', async () => {
    const { bt, headers } = await setup();
    const s = (await scan(headers)).json();
    const [r1, r2] = await Promise.all([
      create(headers, { department: bt.id, helpSessionId: s.helpSessionId }),
      create(headers, { department: bt.id, helpSessionId: s.helpSessionId, title: 'VPN bağlantısı yine kopuyor' }),
    ]);
    expect([r1.statusCode, r2.statusCode]).toEqual([201, 201]);
    const linked = await prisma.helpSession.findMany({ where: { recordId: { not: null } } });
    expect(linked).toHaveLength(2);
    expect(linked.filter((x) => x.id === s.helpSessionId)).toHaveLength(1);
  });

  it('açılış olayı hedef durum ve ekibi, ikinci ekip paylaşımı hedef ekibi taşır', async () => {
    const { bt, headers } = await setup();
    const fin = await createDept('Finans');
    const rec = await recordOf(await create(headers, { department: bt.id, department2: fin.id }));
    const ev = await prisma.recordEvent.findMany({ where: { recordId: rec.id } });
    expect(ev.find((e) => e.type === 'CREATE')).toMatchObject({ toStatus: 'YENI', toTeamId: bt.id });
    expect(ev.find((e) => e.type === 'ASSIGN')).toMatchObject({ toTeamId: fin.id });
  });
});
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `npx vitest run tests/integration/help-log.test.ts -t "kayıt açılışında"`
Expected: FAIL — oturumun `recordId`'si boş.

- [ ] **Step 3: Bağlama fonksiyonunu yaz**

`src/lib/help-log.ts` sonuna:

```ts
/**
 * Kaydı açıldığı yardım oturumuna bağlar; geçerli oturum yoksa sorgusuz bir
 * oturum açar ("kontrol etmeden açılan kayıt" da sayılsın). Kayıt işleminden
 * sonra ve ayrı çalışır: bağlanamasa da kayıt açılmış olur.
 */
export async function linkHelpSession(
  log: FastifyBaseLogger,
  o: { userId: string; sessionId: string | null; recordId: string; anonymous: boolean; restricted: boolean },
): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      const now = new Date();
      const data = { recordId: o.recordId, lastActivityAt: now, ...(o.anonymous ? { userId: null } : {}) };
      let sessionId = await openSession(tx, o.userId, o.sessionId, HelpChannel.YENI_KAYIT, now, 'link');
      // Aynı oturumla eşzamanlı ikinci kayıt öncekinin bağını ezmesin.
      const { count } = await tx.helpSession.updateMany({ where: { id: sessionId, recordId: null }, data });
      if (!count) {
        sessionId = (await tx.helpSession.create({
          data: { userId: o.userId, channel: HelpChannel.YENI_KAYIT, startedAt: now, ...data }, select: { id: true },
        })).id;
      }
      if (o.restricted) await tx.helpQuery.updateMany({ where: { sessionId }, data: { title: null, text: null } });
    });
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'yardım oturumu kayda bağlanamadı');
  }
}
```

- [ ] **Step 4: Kayıt açılışını bağla**

`src/routes/records.ts`:

İçe aktarmayı `import { linkHelpSession, logHelpQuery } from '../lib/help-log.js';` yap.

`createBody` içinde `deptSuggestionApplied` satırının altına:
```ts
  /** Yardım oturumu (kayıt önleme günlüğü): kayıt bu oturuma bağlanır. */
  helpSessionId: z.string().max(64).nullish(),
```

Kayıt oluşturmadaki `events.create` dizisinde ilk nesneye (`type: 'CREATE'`) şu iki alanı ekle:
```ts
                toStatus: RecordStatus.YENI,
                toTeamId: body.department,
```
ikinci ekip nesnesine (`type: 'ASSIGN' as const`) ekle:
```ts
                      toTeamId: body.department2!,
```

`app.log.info({ code: created.code, by: actor.id }, 'kayıt oluşturuldu');` satırının altına:
```ts
    await linkHelpSession(req.log, {
      userId: actor.id,
      sessionId: body.helpSessionId ?? null,
      recordId: created.id,
      anonymous: body.anonymous,
      restricted: body.restricted,
    });
```

- [ ] **Step 5: Testleri çalıştır**

Run: `npx vitest run tests/integration/help-log.test.ts tests/integration/create.test.ts tests/integration/restricted.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/help-log.ts src/routes/records.ts tests/integration/help-log.test.ts
git commit -m "Kayıt açıldığı yardım oturumuna bağlanır; anonimde kişi, kısıtlıda metin silinir; açılış olayı hedefi taşır

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Kayıt adımlarında tipli kolonlar

**Files:**
- Modify: `src/routes/actions.ts` (`mutate`, claim, forward)
- Modify: `src/routes/grants.ts` (devretme olayları, `openOf`)
- Test: `tests/integration/event-columns.test.ts`

**Interfaces:**
- Produces: `mutate` planının `event` alanı `PlanEvent { type: EventType; text: string; meta?: Prisma.InputJsonValue; toTeamId?: string; toUserId?: string }`. Durum değiştiğinde (`nextStatus !== rec.status`) `fromStatus`/`toStatus` `mutate` tarafından yazılır. Task 8 bu imzayı genişletir.

- [ ] **Step 1: Başarısız testi ekle**

`tests/integration/event-columns.test.ts` içindeki `describe('kayıt adımları', ...)` bloğuna ekle:

```ts
  it('üstlenme, durum ve yönlendirme adımları tipli kolonlara yazılır', async () => {
    const { r, t2, m, n, mH, nH } = await setup();
    expect((await act(mH, r.code, 'claim')).statusCode).toBe(200);
    expect((await act(mH, r.code, 'status', { status: 'calisiliyor' })).statusCode).toBe(200);
    expect((await act(mH, r.code, 'forward', { assigneeId: n.id })).statusCode).toBe(200);
    expect((await act(nH, r.code, 'forward', { departmentId: t2.id })).statusCode).toBe(200);
    const ev = await events(r.id);
    expect(ev.map((e) => [e.type, e.fromStatus, e.toStatus, e.toTeamId, e.toUserId])).toEqual([
      ['ASSIGN', 'YENI', 'UZERIME_ALINDI', null, m.id],
      ['STATUS', 'UZERIME_ALINDI', 'CALISILIYOR', null, null],
      ['FORWARD', null, null, null, n.id],
      ['FORWARD', 'CALISILIYOR', 'YENI', t2.id, null],
    ]);
  });

  it('yöneticinin devretmesi hedef kişiyi, havuza dönüş durum geçişini yazar', async () => {
    const { r, m, n, mH } = await setup();
    const admin = await createUser({ name: 'Yönetici', role: Role.ADMIN });
    const aH = await loginAs(app, admin.id);
    await act(mH, r.code, 'claim');
    const handover = (toUserId: string | null) =>
      app.inject({ method: 'POST', url: '/api/admin/handover', headers: aH, payload: { fromUserId: m.id, toUserId, deactivate: false } });

    expect((await handover(n.id)).statusCode).toBe(200);
    expect((await events(r.id)).at(-1)).toMatchObject({ type: 'FORWARD', toUserId: n.id, fromStatus: null });

    const back = await app.inject({ method: 'POST', url: '/api/admin/handover', headers: aH, payload: { fromUserId: n.id, toUserId: null, deactivate: false } });
    expect(back.statusCode).toBe(200);
    expect((await events(r.id)).at(-1)).toMatchObject({ type: 'FORWARD', fromStatus: 'UZERIME_ALINDI', toStatus: 'YENI', toUserId: null });
  });
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `npx vitest run tests/integration/event-columns.test.ts`
Expected: FAIL — `fromStatus`/`toUserId` `null`.

- [ ] **Step 3: `mutate`'i değiştir**

`src/routes/actions.ts`:

`mutate` fonksiyonundan önce ekle:
```ts
/** Olay satırı; hedef alanları rapor içindir (rapor.kayit_adimi). */
type PlanEvent = {
  type: EventType;
  text: string;
  meta?: Prisma.InputJsonValue;
  /** Açılış ve yönlendirmede hedef ekip. */
  toTeamId?: string;
  /** Üstlenme ve kişiye devirde hedef kişi. */
  toUserId?: string;
};
```

`mutate`'in `plan` dönüş tipinde `event: { type: EventType; text: string; meta?: unknown };` satırını `event: PlanEvent;` yap.

`if (planned.nextStatus && !canTransition(...)) { ... }` bloğunun hemen altına:
```ts
    const statusChanged = planned.nextStatus !== undefined && planned.nextStatus !== rec.status;
```

`tx.recordEvent.create({ data: { ... } })` içindeki `data` nesnesini şununla değiştir (Task 1'de değişen `meta` satırı dahil):
```ts
      data: {
        recordId: rec.id,
        type: planned.event.type,
        text: planned.event.text,
        byId: opts.actorId,
        ...(statusChanged ? { fromStatus: rec.status, toStatus: planned.nextStatus } : {}),
        toTeamId: planned.event.toTeamId ?? null,
        toUserId: planned.event.toUserId ?? null,
        ...(planned.event.meta !== undefined ? { meta: planned.event.meta } : {}),
      },
```

Claim planında `event: { type: EventType.ASSIGN, text: ... }` nesnesine `toUserId: a.id,` ekle.

Forward planında `event: { type: EventType.FORWARD, text, meta: { departmentId, assigneeId } },` satırını şununla değiştir:
```ts
        event: { type: EventType.FORWARD, text, meta: { departmentId, assigneeId }, toTeamId: departmentId, toUserId: assigneeId },
```

- [ ] **Step 4: Devretmeyi değiştir**

`src/routes/grants.ts`:

`openOf` sorgusunun `select`'ine `status: true,` ekle.

Kişiye devir dalındaki `tx.recordEvent.create({ data: { ... } })` nesnesine `toUserId: to.id,` ekle.

Havuza dönüş dalındaki `tx.recordEvent.create({ data: { ... } })` nesnesine:
```ts
              fromStatus: r.status === RecordStatus.YENI ? null : r.status,
              toStatus: r.status === RecordStatus.YENI ? null : RecordStatus.YENI,
```
ekle.

- [ ] **Step 5: Testleri çalıştır**

Run: `npx vitest run tests/integration/event-columns.test.ts tests/integration/grants.test.ts tests/integration/records.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/routes/actions.ts src/routes/grants.ts tests/integration/event-columns.test.ts
git commit -m "Kayıt adımları önceki/sonraki durumu ve hedef ekip/kişiyi tipli kolonlarda taşır

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Ek bilgi akışı (sunucu)

**Files:**
- Create: `src/domain/info-request.ts`
- Modify: `src/domain/enums.ts`, `src/domain/permissions.ts`, `src/routes/actions.ts`, `src/routes/grants.ts`, `src/lib/serialize.ts`, `prisma/seed.ts`
- Test: `tests/unit/info-request.test.ts` (yeni), `tests/integration/info-request.test.ts` (yeni)

**Interfaces:**
- Consumes: Task 7 `PlanEvent`, `statusChanged`.
- Produces:
  - `statusAfterInfo(type: string, before: string): RecordStatus`
  - `EventType.INFO_REQUEST | INFO_RESPONSE | INFO_CANCEL`, `NotificationType.INFO_PROVIDED`
  - İzin `infoRequest` (permissions listesine de eklenir → arayüz `record.permissions.infoRequest`)
  - `POST /api/records/:code/info-request` `{ question: string (5–1000) }` → `{ record }`; açık istek varsa 409
  - Detay yanıtında `record.infoRequest: { question: string; requestedAt: string; requestedBy: string | null } | null`
  - `mutate` planına `infoQuestion?: string`, `infoAnswer?: { id: string; answer: string }`; plan girdisine `openInfo: { id: string; statusBefore: string } | null`

- [ ] **Step 1: Başarısız birim testini yaz**

`tests/unit/info-request.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { statusAfterInfo } from '../../src/domain/info-request.js';

describe('ek bilgi yanıtından sonra durum', () => {
  it('istekten önceki açık duruma döner', () => {
    expect(statusAfterInfo('BILGI', 'CALISILIYOR')).toBe('CALISILIYOR');
    expect(statusAfterInfo('BILGI', 'INCELENIYOR')).toBe('INCELENIYOR');
    expect(statusAfterInfo('BILGI', 'YENI')).toBe('YENI');
    expect(statusAfterInfo('ONERI', 'DEGERLENDIRILIYOR')).toBe('DEGERLENDIRILIYOR');
  });

  it('dönülemeyen ya da anlamsız durumda iş sürüyor sayılır', () => {
    expect(statusAfterInfo('BILGI', 'UZERIME_ALINDI')).toBe('CALISILIYOR');
    expect(statusAfterInfo('BILGI', 'EK_BILGI')).toBe('CALISILIYOR');
    expect(statusAfterInfo('BILGI', 'COZULDU')).toBe('CALISILIYOR');
    expect(statusAfterInfo('ONERI', 'EK_BILGI')).toBe('DEGERLENDIRILIYOR');
  });
});
```

- [ ] **Step 2: Başarısız entegrasyon testini yaz**

`tests/integration/info-request.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Role } from '../../src/domain/enums.js';
import { createDept, createRecord, createUser, loginAs, makeApp, prisma, resetDb } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); });
beforeEach(async () => { await resetDb(); });

type Headers = { cookie: string };
const act = (headers: Headers, code: string, action: string, payload: object = {}) =>
  app.inject({ method: 'POST', url: `/api/records/${code}/${action}`, headers, payload });

async function setup() {
  const t = await createDept('İnsan Kaynakları');
  const t2 = await createDept('Finans');
  const m = await createUser({ name: 'Sahip', role: Role.TEAM_MEMBER, departmentId: t.id });
  const n = await createUser({ name: 'Ekip Arkadaşı', role: Role.TEAM_MEMBER, departmentId: t.id });
  const c = await createUser({ name: 'Açan' });
  const r = await createRecord({ createdById: c.id, departmentId: t.id });
  const h = { m: await loginAs(app, m.id), n: await loginAs(app, n.id), c: await loginAs(app, c.id) };
  await act(h.m, r.code, 'claim');
  await act(h.m, r.code, 'status', { status: 'calisiliyor' });
  return { t, t2, m, n, c, r, h };
}
const open = (recordId: string) =>
  prisma.infoRequest.findFirst({ where: { recordId, answeredAt: null, cancelledAt: null } });

describe('ek bilgi isteği', () => {
  it('sahip soruyla ister; kayıt ek bilgi bekler, açana bildirim gider, detayda soru görünür', async () => {
    const { r, c, h } = await setup();
    const res = await act(h.m, r.code, 'info-request', { question: 'Hangi tarihten itibaren?' });
    expect(res.statusCode).toBe(200);
    expect(res.json().record.status).toBe('ek_bilgi');
    expect(await open(r.id)).toMatchObject({ question: 'Hangi tarihten itibaren?', statusBefore: 'CALISILIYOR' });
    expect(await prisma.notification.count({ where: { userId: c.id, type: 'INFO_REQUESTED' } })).toBe(1);
    const ev = await prisma.recordEvent.findFirstOrThrow({ where: { recordId: r.id, type: 'INFO_REQUEST' } });
    expect(ev).toMatchObject({ fromStatus: 'CALISILIYOR', toStatus: 'EK_BILGI' });

    const detail = (await app.inject({ method: 'GET', url: `/api/records/${r.code}`, headers: h.c })).json().record;
    expect(detail.infoRequest).toMatchObject({ question: 'Hangi tarihten itibaren?' });
    expect(detail.permissions.infoRequest).toBe(false);
  });

  it('soru zorunlu, ikinci açık istek 409, açan isteyemez, durum listesinden ek bilgi seçilemez', async () => {
    const { r, h } = await setup();
    expect((await act(h.m, r.code, 'info-request', { question: 'kı' })).statusCode).toBe(400);
    expect((await act(h.c, r.code, 'info-request', { question: 'Açan soruyor mu?' })).statusCode).toBe(403);
    expect((await act(h.m, r.code, 'status', { status: 'ek_bilgi' })).statusCode).toBe(400);
    expect((await act(h.m, r.code, 'info-request', { question: 'İlk soru burada' })).statusCode).toBe(200);
    expect((await act(h.m, r.code, 'info-request', { question: 'İkinci soru burada' })).statusCode).toBe(409);
  });

  it('açanın güncellemesi yanıttır: istek kapanır, kayıt önceki durumuna döner, sahibe bildirim gider', async () => {
    const { r, m, c, h } = await setup();
    await act(h.m, r.code, 'info-request', { question: 'Hangi tarihten itibaren?' });
    const res = await act(h.c, r.code, 'comments', { text: '1 Kasım’dan itibaren.' });
    expect(res.statusCode).toBe(200);
    expect(res.json().record.status).toBe('calisiliyor');
    expect(res.json().record.infoRequest).toBeNull();

    const req = await prisma.infoRequest.findFirstOrThrow({ where: { recordId: r.id } });
    expect(req).toMatchObject({ answer: '1 Kasım’dan itibaren.', answeredById: c.id, cancelledAt: null });
    const ev = await prisma.recordEvent.findUniqueOrThrow({ where: { id: req.answerEventId! } });
    expect(ev).toMatchObject({ type: 'INFO_RESPONSE', fromStatus: 'EK_BILGI', toStatus: 'CALISILIYOR' });
    expect(await prisma.notification.count({ where: { userId: m.id, type: 'INFO_PROVIDED' } })).toBe(1);
  });

  it('ekipten birinin güncellemesi yanıt sayılmaz', async () => {
    const { r, h } = await setup();
    await act(h.m, r.code, 'info-request', { question: 'Hangi tarihten itibaren?' });
    const res = await act(h.n, r.code, 'comments', { text: 'Ben de merak ediyorum.' });
    expect(res.statusCode).toBe(200);
    expect(res.json().record.status).toBe('ek_bilgi');
    expect(await open(r.id)).not.toBeNull();
  });

  it('yanıt beklenmeden çözülen ya da başka ekibe giden kayıtta istek iptal olur', async () => {
    const a = await setup();
    await act(a.h.m, a.r.code, 'info-request', { question: 'Hangi tarihten itibaren?' });
    expect((await act(a.h.m, a.r.code, 'resolve', { resolution: 'Bilgi olmadan da çözüldü, teşekkürler.' })).statusCode).toBe(200);
    expect((await prisma.infoRequest.findFirstOrThrow({ where: { recordId: a.r.id } })).cancelledAt).toBeTruthy();
    expect(await prisma.recordEvent.count({ where: { recordId: a.r.id, type: 'INFO_CANCEL' } })).toBe(1);

    await resetDb();
    const b = await setup();
    await act(b.h.m, b.r.code, 'info-request', { question: 'Hangi tarihten itibaren?' });
    expect((await act(b.h.m, b.r.code, 'forward', { departmentId: b.t2.id })).statusCode).toBe(200);
    expect(await open(b.r.id)).toBeNull();
  });

  it('yöneticinin devretmesi: havuza dönüşte istek iptal, kişiye devirde açık kalır', async () => {
    const a = await setup();
    const admin = await createUser({ name: 'Yönetici', role: Role.ADMIN });
    const aH = await loginAs(app, admin.id);
    await act(a.h.m, a.r.code, 'info-request', { question: 'Hangi tarihten itibaren?' });
    const handover = (fromUserId: string, toUserId: string | null) =>
      app.inject({ method: 'POST', url: '/api/admin/handover', headers: aH, payload: { fromUserId, toUserId, deactivate: false } });

    expect((await handover(a.m.id, a.n.id)).statusCode).toBe(200);
    expect(await open(a.r.id)).not.toBeNull();
    expect((await handover(a.n.id, null)).statusCode).toBe(200);
    expect(await open(a.r.id)).toBeNull();
    expect((await prisma.record.findUniqueOrThrow({ where: { id: a.r.id } })).status).toBe('YENI');
  });
});
```

- [ ] **Step 3: Testleri çalıştır, başarısız olduklarını gör**

Run: `npx vitest run tests/unit/info-request.test.ts tests/integration/info-request.test.ts`
Expected: FAIL — modül yok; `/info-request` 404.

- [ ] **Step 4: Sabitleri ve izni ekle**

`src/domain/enums.ts` → `EventType` içinde `LEARN: 'LEARN',` satırının altına:
```ts
  /** Ek bilgi istendi (soru olay metninde, InfoRequest satırında). */
  INFO_REQUEST: 'INFO_REQUEST',
  /** Kaydı açan ek bilgiyi yanıtladı. */
  INFO_RESPONSE: 'INFO_RESPONSE',
  /** Ek bilgi isteği yanıt beklenmeden kapandı. */
  INFO_CANCEL: 'INFO_CANCEL',
```
`NotificationType` içinde `INFO_REQUESTED: 'INFO_REQUESTED',` satırının altına:
```ts
  /** Kaydı açan istenen ek bilgiyi yazdı (sahip). */
  INFO_PROVIDED: 'INFO_PROVIDED',
```

`src/domain/permissions.ts`:
- `Action` birleşimine `| 'infoRequest'` ekle.
- `can` içinde `case 'status':` satırının üstüne `case 'infoRequest':` ekle (ikisi aynı kural) ve üstteki yorumu `// Ara durumları, çözümü ve ek bilgi isteğini yalnızca kaydı üzerine alan kişi yapar.` yap.
- `permissionsFor` listesine `'infoRequest'` ekle.

`src/domain/info-request.ts`:

```ts
import { RecordStatus, RecordType } from './enums.js';
import { isOpen } from './constants.js';
import { canTransition } from './permissions.js';

/**
 * Ek bilgi yanıtlanınca kayıt istekten önceki durumuna döner. O durum Ek
 * Bilgi'nin kendisiyse, kapalıysa ya da oraya geçilemiyorsa (ör.
 * Sahiplenildi) iş sürüyor demektir: bilgide Çalışılıyor, öneride
 * Değerlendiriliyor.
 */
export function statusAfterInfo(type: string, before: string): RecordStatus {
  if (before !== RecordStatus.EK_BILGI && isOpen(before) && canTransition(RecordStatus.EK_BILGI, before)) {
    return before as RecordStatus;
  }
  return type === RecordType.ONERI ? RecordStatus.DEGERLENDIRILIYOR : RecordStatus.CALISILIYOR;
}
```

- [ ] **Step 5: `mutate`'e ek bilgi adımlarını ekle**

`src/routes/actions.ts`:

İçe aktarmalara `import { statusAfterInfo } from '../domain/info-request.js';`.

`mutate`'in `plan` girdi tipine (`restricted: boolean;` satırının altına):
```ts
      /** Yanıt bekleyen ek bilgi isteği. */
      openInfo: { id: string; statusBefore: string } | null;
```
`plan` dönüş tipine (`attachmentIds?: string[];` satırının altına):
```ts
      /** Yeni ek bilgi isteği; istekten önceki durum kaydın şimdiki durumudur. */
      infoQuestion?: string;
      /** Bu güncelleme açık ek bilgi isteğinin yanıtı. */
      infoAnswer?: { id: string; answer: string };
```

`tx.record.findUnique` `select`'ine (`firstResponseAt: true,` satırının altına):
```ts
        infoRequests: { where: { answeredAt: null, cancelledAt: null }, select: { id: true, statusBefore: true }, take: 1 },
```

`const planned = opts.plan(rec);` satırını şununla değiştir:
```ts
    const openInfo = rec.infoRequests[0] ?? null;
    const planned = opts.plan({ ...rec, openInfo });
```

Ekler bağlandıktan sonra (`if (ids.length) { ... }` bloğunun altına, `const updated = ...` satırından önce):
```ts
    const now = new Date();
    if (planned.infoQuestion) {
      await tx.infoRequest.create({
        data: { recordId: rec.id, requestedById: opts.actorId, requestedAt: now, question: planned.infoQuestion, statusBefore: rec.status },
      });
    } else if (planned.infoAnswer) {
      await tx.infoRequest.update({
        where: { id: planned.infoAnswer.id },
        data: { answeredAt: now, answeredById: opts.actorId, answer: planned.infoAnswer.answer, answerEventId: event.id },
      });
    } else if (openInfo && statusChanged) {
      // Yanıt beklenmeden kayıt başka duruma geçti: istek açık kalmasın.
      await tx.infoRequest.update({ where: { id: openInfo.id }, data: { cancelledAt: now } });
      await tx.recordEvent.create({
        data: { recordId: rec.id, type: EventType.INFO_CANCEL, text: 'Ek bilgi isteği yanıt beklenmeden kapandı.', byId: opts.actorId, at: now },
      });
    }
```

- [ ] **Step 6: İstek ucunu ekle, durum ucundan Ek Bilgi'yi kaldır, yorumu yanıta bağla**

`src/routes/actions.ts`:

Durum ucunda `const next = STATUS_FROM_SLUG[parsed.data.status];` satırının altına:
```ts
    if (next === RecordStatus.EK_BILGI) throw badRequest('Ek bilgi “Ek Bilgi İste” ile istenir; soru zorunlu.');
```
Aynı uçtaki hata metinlerini güncelle: `'Bu uçtan yalnızca ara durumlar (İnceleniyor, Çalışılıyor, Değerlendiriliyor) ayarlanır.'`, `'Öneride ara durum olarak yalnızca Değerlendiriliyor seçilebilir.'`, `'Bilgi talebinde ara durum olarak İnceleniyor ya da Çalışılıyor seçilebilir.'`. Plan dönüşündeki `...(next === RecordStatus.EK_BILGI ? { notify: ... } : {}),` bloğunu sil (bildirim artık istek ucunda).

Durum ucunun hemen altına yeni uç:
```ts
  /** Ek bilgi iste: soru zorunlu; yanıt, kaydı açanın güncellemesiyle gelir (yorum ucu). */
  app.post('/api/records/:code/info-request', async (req) => {
    const a = actorOf(req);
    const parsed = z
      .object({ question: z.string().trim().min(5, 'Sorunuzu en az 5 karakterle yazın.').max(1000) })
      .safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]!.message);
    const question = parsed.data.question;

    const rec = await mutate(app, {
      code: codeParam(req),
      actorId: a.id,
      actorRole: a.role,
      actorDept: a.departmentId,
      action: 'infoRequest',
      ip: req.ip,
      plan: (r) => {
        if (r.openInfo) throw conflict('Bu kayıtta yanıt bekleyen bir ek bilgi isteği zaten var.');
        return {
          nextStatus: RecordStatus.EK_BILGI,
          data: { status: RecordStatus.EK_BILGI, ...stampFirstResponse(r) },
          event: { type: EventType.INFO_REQUEST, text: `Ek bilgi istendi: ${question}` },
          infoQuestion: question,
          notify: {
            userIds: [r.createdById],
            type: NotificationType.INFO_REQUESTED,
            text: `${codeParam(req)} için sizden ek bilgi bekleniyor. Kaydı açıp soruyu yanıtlayın.`,
          },
        };
      },
    });
    return { record: await serializeRecord(rec, a) };
  });
```

Yorum ucunda `plan: (r) => ({ ... }),` ifadesini şununla değiştir:
```ts
      plan: (r) => {
        // Açık ek bilgi isteği varken açanın güncellemesi yanıttır: istek kapanır,
        // kayıt istekten önceki durumuna döner. Ekipten birinin yazdığı yanıt sayılmaz.
        if (r.openInfo && r.createdById === a.id) {
          const back = statusAfterInfo(r.type, r.openInfo.statusBefore);
          return {
            nextStatus: back,
            data: { status: back },
            event: { type: EventType.INFO_RESPONSE, text },
            attachmentIds: parsed.data.attachmentIds,
            infoAnswer: { id: r.openInfo.id, answer: text },
            notify: {
              userIds: [r.assigneeId],
              type: NotificationType.INFO_PROVIDED,
              text: `${codeParam(req)} için istenen ek bilgi geldi.`,
            },
          };
        }
        return {
          // Ekipten gelen ilk yorum da geri dönüş sayılır; kaydı açanın kendi
          // yorumu sayılmamalı.
          data: r.createdById === a.id ? {} : stampFirstResponse(r),
          event: { type: EventType.COMMENT, text },
          attachmentIds: parsed.data.attachmentIds,
          // Açan yazdıysa sahibine, ekipten biri yazdıysa açana.
          notify: {
            userIds: r.createdById === a.id ? [r.assigneeId] : [r.createdById],
            type: NotificationType.COMMENT,
            text: `${codeParam(req)} kaydına yeni güncelleme eklendi.`,
          },
        };
      },
```

- [ ] **Step 7: Devretmede havuza dönen kaydın isteğini iptal et**

`src/routes/grants.ts` havuza dönüş dalında, `tx.recordEvent.create(...)` çağrısının altına:
```ts
          // Havuza dönen kayıt ek bilgi beklemiyor artık; yanıt kimseye gitmezdi.
          const cancelled = await tx.infoRequest.updateMany({
            where: { recordId: r.id, answeredAt: null, cancelledAt: null }, data: { cancelledAt: new Date() },
          });
          if (cancelled.count) {
            await tx.recordEvent.create({
              data: { recordId: r.id, type: EventType.INFO_CANCEL, byId: actor.id, text: 'Ek bilgi isteği yanıt beklenmeden kapandı.' },
            });
          }
```

- [ ] **Step 8: Detayda açık isteği gönder**

`src/lib/serialize.ts`:
- `import type { Attachment, Record as DbRecord, RecordEvent } from '@prisma/client';` satırını `import type { Attachment, InfoRequest, Record as DbRecord, RecordEvent } from '@prisma/client';` yap.
- `FullRecord` tipine `infoRequests?: Pick<InfoRequest, 'question' | 'requestedAt' | 'requestedById'>[];` ekle.
- `detailInclude`'a ekle:
```ts
  infoRequests: {
    where: { answeredAt: null, cancelledAt: null },
    select: { question: true, requestedAt: true, requestedById: true },
    take: 1,
  },
```
- `serializeRecord` dönüşünde `attachments: ...` satırının altına:
```ts
    /** Yanıt bekleyen ek bilgi isteği; liste yanıtında yok (yalnızca detay). */
    infoRequest: rec.infoRequests?.[0]
      ? {
          question: rec.infoRequests[0].question,
          requestedAt: rec.infoRequests[0].requestedAt.toISOString(),
          requestedBy: rec.infoRequests[0].requestedById,
        }
      : null,
```

- [ ] **Step 9: Tohum verisinde ek bilgi bekleyen kayıtlara istek ekle**

`prisma/seed.ts` kayıt üreten fonksiyonun döndürdüğü nesnede `events: { create: events },` satırının altına:
```ts
      // Ek bilgi bekleyen demo kayıtları yanıtlanabilsin.
      ...(status === RecordStatus.EK_BILGI && assignee
        ? {
            infoRequests: {
              create: [{
                requestedById: by(assignee.key),
                requestedAt: firstResponseAt ?? createdAt,
                question: 'Talebinizi netleştirmek için biraz daha ayrıntı verebilir misiniz?',
                statusBefore: isOneri ? RecordStatus.DEGERLENDIRILIYOR : RecordStatus.CALISILIYOR,
              }],
            },
          }
        : {}),
```

- [ ] **Step 10: Ek Bilgi'yi durum listesinden isteyen eski testleri yeni akışa uyarla**

`tests/integration/modules.test.ts:64-65`:
```ts
    const ek = await post(w.ikMember.id, `/api/records/${o.code}/status`, { status: 'ek_bilgi' });
    expect(ek.json().record.status).toBe('ek_bilgi');
```
→
```ts
    // Ek bilgi artık durum listesinden değil, soruyla istenir.
    expect((await post(w.ikMember.id, `/api/records/${o.code}/status`, { status: 'ek_bilgi' })).statusCode).toBe(400);
    const ek = await post(w.ikMember.id, `/api/records/${o.code}/info-request`, { question: 'Hangi birimde uygulanacak?' });
    expect(ek.json().record.status).toBe('ek_bilgi');
```

`tests/integration/record-events.test.ts:55`:
```ts
    await post(`/api/records/${w.rec.code}/status`, h, { status: 'ek_bilgi', note: 'Bordro dönemini yazın' });
```
→
```ts
    await post(`/api/records/${w.rec.code}/info-request`, h, { question: 'Bordro dönemini yazın' });
```

- [ ] **Step 11: Testleri çalıştır**

Run: `npm run typecheck && npx vitest run tests/unit/info-request.test.ts tests/integration/info-request.test.ts tests/unit/permissions.test.ts tests/integration/notifications.test.ts tests/integration/records.test.ts tests/integration/modules.test.ts tests/integration/record-events.test.ts`
Expected: PASS. `permissions.test.ts` izin listesinin tamamını karşılaştırıyorsa beklenen listeye `infoRequest` eklenir.

- [ ] **Step 12: Commit**

```bash
git add src/domain/enums.ts src/domain/permissions.ts src/domain/info-request.ts src/routes/actions.ts src/routes/grants.ts src/lib/serialize.ts prisma/seed.ts tests/unit/info-request.test.ts tests/integration/info-request.test.ts tests/unit/permissions.test.ts tests/integration/modules.test.ts tests/integration/record-events.test.ts
git commit -m "Ek bilgi akışı: soru zorunlu istek, açanın güncellemesi yanıt olur, yanıt beklenmeden ilerleyince istek kapanır

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Arayüz — yardım oturumu ve sonuç etkileşimleri

**Files:**
- Modify: `public/api-store.js` (oturum yardımcısı, tarama, kayıt açma)
- Modify: `public/index.html` (`matchCard`, `solvedByMatch`, eşleşme bağlama, asistan `askMl`)
- Modify: `public/modules.js` (Kaynak Bul)

**Interfaces:**
- Consumes: Task 3–6 uçları.
- Produces: `window.IhHelp = { session: { get(): string | null, set(id: string | null): void }, mark(resultId: string | null, action: 'open' | 'helpful' | 'unhelpful'): void }`.

- [ ] **Step 1: Oturum yardımcısını ekle**

`public/api-store.js` → `const Api = { ... };` nesnesinden hemen sonra:

```js
  /* Yardım oturumu (kayıt önleme günlüğü): kimliği sunucu üretir, sekme
     boyunca taşınır. Kayıt açılınca ya da "işime yaradı" ile form kapanınca
     bırakılır. Tarayıcı deposu kullanılamazsa günlük yalnızca oturumsuz kalır. */
  window.IhHelp = {
    session: {
      get() { try { return sessionStorage.getItem('ih_help') || null; } catch (_) { return null; } },
      set(id) {
        try { if (id) sessionStorage.setItem('ih_help', id); else sessionStorage.removeItem('ih_help'); } catch (_) { /* yok sayılabilir */ }
      },
    },
    /** Sonuçla etkileşim; yazılamasa da arayüz etkilenmez. */
    mark(resultId, action) {
      if (resultId) req('POST', '/api/help/results/' + encodeURIComponent(resultId), { action }).catch(() => {});
    },
  };
```

- [ ] **Step 2: Taramada ve kayıt açmada kimliği taşı**

`public/api-store.js` → `scanThenRender` içindeki `Api.similar({ ... })` gövdesine `restricted:` satırının altına:
```js
          helpSessionId: IhHelp.session.get(),
```
`if (f !== form) return;` satırının (yanıttan sonraki ilk) altına:
```js
        if (out.helpSessionId) IhHelp.session.set(out.helpSessionId);
```
`similarCache = out.matches.map((m) => ({` bloğunda `keywords: m.terms,` satırının altına:
```js
          resultId: m.resultId || null,
```

Kayıt açma: öneri ve bilgi `payload` nesnelerinin ikisine de `restricted:` satırının altına:
```js
        helpSessionId: IhHelp.session.get(),
```
`let rec = (await Api.create(payload)).record;` satırının altına:
```js
      IhHelp.session.set(null);   // kayıt açıldı: sonraki yardım yeni oturum
```

- [ ] **Step 3: Eşleşme kartında tıklamayı ve beyanı bildir**

`public/index.html` → `matchCard`:
- `'<a class="ext-link" href="'` parçasını `'<a class="ext-link" data-rid="'+esc(m.resultId||'')+'" href="'` yap.
- `data-solved="'+esc(m.record.code)+'"` parçasını `data-solved="'+esc(m.record.code)+'" data-rid="'+esc(m.resultId||'')+'"` yap.

`solvedByMatch` fonksiyonunu şununla değiştir:
```js
function solvedByMatch(rid){
  const snap = {
    type: form.type, title: $('#fTitle').value, desc: $('#fDesc').value,
    d1: $('#fDept1').value, d2: $('#fDept2').value, prio: $('#fPrio').value,
    restricted: $('#fRestricted').checked,
    files: (form.files || []).slice(),
  };
  /* Beyan günlüğe yazılır ve oturum kapanır; "Geri al" ikisini de geri alır. */
  const help = window.IhHelp, sid = help ? help.session.get() : null;
  if (help) { help.mark(rid, 'helpful'); help.session.set(null); }
  resetForm();
  toast('Kayıt açılmadı — önerilen çözüm işinize yaradı.', 'ok', { label:'Geri al', run(){
    if (help) { help.mark(rid, 'unhelpful'); help.session.set(sid); }
    restoreForm(snap);
  } });
}
```

Eşleşmeleri bağlayan satırı (`$$('#mlResults [data-solved]').forEach(b => { b.onclick = solvedByMatch; });`) şununla değiştir:
```js
    $$('#mlResults [data-solved]').forEach(b => { b.onclick = () => solvedByMatch(b.dataset.rid); });
    $$('#mlResults a.ext-link[data-rid]').forEach(a => a.addEventListener('click', () => window.IhHelp && IhHelp.mark(a.dataset.rid, 'open')));
```

Asistan `askMl` içinde `out = await IhApi.similar({ title: text, description: '' });` satırını şununla değiştir:
```js
    try {
      out = await IhApi.similar({ title: text, description: '', channel: 'ASISTAN', limit: 1,
        helpSessionId: window.IhHelp ? IhHelp.session.get() : null });
    } catch (_) { out = null; }
    if (out && out.helpSessionId && window.IhHelp) IhHelp.session.set(out.helpSessionId);
```
(eski `try { ... } catch (_) { out = null; }` satırının tamamı bununla değişir.)

- [ ] **Step 4: Kaynak Bul'da kimliği taşı ve tıklamayı bildir**

`public/modules.js`:
- `linkHtml` tanımını şununla değiştir:
```js
  const linkHtml = (u, rid) =>
    '<a class="ext-link" ' + (rid ? 'data-rid="' + esc(rid) + '" ' : '') + 'href="' + esc(u) +
    '" target="_blank" rel="noopener noreferrer">' + esc(shortUrl(u)) + '</a>';
```
- `renderSearch` içinde `rq.addEventListener(...)` satırının altına:
```js
    // Sonuç bağlantısına tıklama kayıt önleme günlüğüne yazılır.
    $('#resRes').addEventListener('click', (e) => {
      const a = e.target.closest('a[data-rid]');
      if (a && window.IhHelp) IhHelp.mark(a.dataset.rid, 'open');
    });
```
- `loadRes` içinde `const out = await api('GET', '/api/search/resources?q=' + encodeURIComponent(q));` satırını şununla değiştir:
```js
      const sid = q && window.IhHelp ? IhHelp.session.get() : null;
      const out = await api('GET', '/api/search/resources?' + new URLSearchParams(sid ? { q, helpSessionId: sid } : { q }));
      if (out.helpSessionId && window.IhHelp) IhHelp.session.set(out.helpSessionId);
```
- Sonuç satırında `linkHtml(x.url)` çağrısını `linkHtml(x.url, x.resultId)` yap.

- [ ] **Step 5: Tarayıcıda doğrula**

Yerel sunucuyu yeniden başlat (önizleme: `preview_stop` + `preview_start` `ichatlar-app-baslat`). Bir çalışan olarak gir:
1. Yeni Kayıt → Bilgi talebi; başlığa "VPN bağlantısı kopuyor", açıklamaya "Evden çalışırken VPN bağlantısı sık sık kopuyor." yaz, 2 sn bekle (otomatik tarama), açıklamaya bir kelime daha ekle, 2 sn bekle.
2. Bir eşleşmede "Bu çözüm işime yaradı"ya bas, ardından bildirimdeki "Geri al"a bas, sonra yeniden "işime yaradı".
3. Kaynak Bul'da "vpn", sonra "vpn kur" yaz; bir Bilgi Bankası bağlantısına tıkla.
4. Asistana "vpn kopuyor" yaz.

Run:
```bash
npx tsx -e "import { prisma } from './src/db.ts'; const s = await prisma.helpSession.findMany({ orderBy: { startedAt: 'desc' }, take: 4, include: { queries: { include: { results: true } } } }); console.dir(s.map((x) => ({ kanal: x.channel, kayit: x.recordId, sorgular: x.queries.map((q) => ({ tur: q.kind, metin: q.title ?? q.text, sonuc: q.results.length, acildi: q.results.filter((r) => r.openedAt).length, yaradi: q.results.filter((r) => r.helpfulAt).length })) })), { depth: 5 }); await prisma.\$disconnect();"
```
Expected: Yeni Kayıt oturumunda **tek** ML_TARAMA sorgusu (iki tarama birleşti) ve `yaradi: 1`; ondan sonraki oturum KAYNAK_BUL ile başlar (işime yaradı oturumu kapattı), **tek** ARAMA sorgusu ("vpn kur") ve `acildi: 1`; asistan sorusu aynı Kaynak Bul oturumunda ASISTAN sorgusu. Konsolda hata yok (`read_console_messages`).

- [ ] **Step 6: Commit**

```bash
git add public/api-store.js public/index.html public/modules.js
git commit -m "Arayüz: yardım oturumu sekme boyunca taşınır; tıklama, işime yaradı ve geri alma günlüğe gider

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Arayüz — Ek Bilgi İste ve Yanıtla

**Files:**
- Modify: `public/api-store.js` (`actInfoRequest`, `actStatus`, `actComment`)
- Modify: `public/index.html` (`renderDetail` düğmesi, bilgi kutusu, güncelleme alanı, aksiyon yönlendirici)

**Interfaces:**
- Consumes: Task 8 `record.permissions.infoRequest`, `record.infoRequest`, `POST /info-request`.

- [ ] **Step 1: Pencereyi ve düğmeyi ekle**

`public/api-store.js` → `window.actStatus = ...` tanımının altına:
```js
  window.actInfoRequest = function (r) {
    openModal(
      'Ek Bilgi İste',
      '<div class="field"><label for="infoQ">Kaydı açan kişiye sorunuz</label>' +
        '<textarea id="infoQ" maxlength="1000" placeholder="Neyi öğrenmeniz gerekiyor? Bu metin kaydı açan kişiye görünür."></textarea>' +
        '<p class="hint" style="margin-top:8px">Kayıt “Ek Bilgi Bekleniyor” olur. Yanıt gelince kayıt kaldığı duruma döner ve size bildirim gelir.</p></div>',
      [
        { label: 'İptal', cls: 'btn-ghost' },
        {
          label: 'Soruyu Gönder',
          cls: 'btn-primary',
          run() {
            const q = ($('#infoQ').value || '').trim();
            if (q.length < 5) return toast('Sorunuzu en az 5 karakterle yazın', 'err');
            return run(r.code, 'info-request', { question: q }, 'Ek bilgi istendi').then(closeModal, () => {});
          },
        },
      ],
    );
  };
```

`window.actStatus` içinde:
```js
    // Öneri kendi akışında: Değerlendiriliyor ya da Ek Bilgi.
    const ids = r.type === 'oneri' ? ['degerlendiriliyor', 'ek_bilgi'] : ['inceleniyor', 'calisiliyor', 'ek_bilgi'];
```
→
```js
    // Ek bilgi ayrı düğmeyle istenir (soru zorunlu).
    const ids = r.type === 'oneri' ? ['degerlendiriliyor'] : ['inceleniyor', 'calisiliyor'];
```

`window.actComment` içinde `await run(r.code, 'comments', { text: t, attachmentIds: ids }, 'Güncelleme eklendi');` satırını şununla değiştir:
```js
      await run(r.code, 'comments', { text: t, attachmentIds: ids }, el && el.dataset.answer ? 'Yanıt gönderildi' : 'Güncelleme eklendi');
```

`public/index.html` → `renderDetail`:
- `if (p.status)  acts.push(...)` satırının altına:
```js
  if (p.infoRequest) acts.push('<button class="btn btn-soft" data-act="info">Ek Bilgi İste</button>');
```
- `const ekBilgi = ...;` tanımını şununla değiştir:
```js
  /* Ek bilgi: açan kişi soruyu kaydın üstünde görür ve aşağıdan yanıtlar;
     ekip tarafı neyin beklendiğini görür. */
  const info = r.infoRequest;
  const answering = isCreator && r.status === 'ek_bilgi' && !!info;
  const ekBilgi = r.status === 'ek_bilgi' && info
    ? '<div class="await-me">'+icon('info')+'<div>'
      + (isCreator
        ? '<b>Ekip sizden ek bilgi istiyor:</b><br>' + esc(info.question)
          + '<br>Aşağıdaki “Yanıtla” alanına yazın; gönderince kayıt ekibe döner.'
        : '<b>Kaydı açan kişiden ek bilgi bekleniyor:</b><br>' + esc(info.question))
      + '</div></div>'
    : r.status === 'ek_bilgi' && isCreator
      ? '<div class="await-me">'+icon('info')+'<div><b>Ekip sizden ek bilgi bekliyor.</b><br>'
        + 'Aşağıdaki “Güncelleme Ekle” alanından yanıt yazın; kaydın sahibine bildirim gider.</div></div>'
      : '';
```
- Güncelleme alanındaki
```js
          ? '<div class="field" style="margin:18px 0 10px"><label for="cmtInput">Yorum / Güncelleme</label>'
            + '<textarea id="cmtInput" placeholder="Durum güncellemesi veya yanıt yazın..."></textarea></div>'
            + (typeof attachPicker === 'function' ? attachPicker('comment') : '')
            + '<button class="btn btn-soft" data-act="comment">Güncelleme Ekle</button>'
```
parçasını şununla değiştir:
```js
          ? '<div class="field" style="margin:18px 0 10px"><label for="cmtInput">'+(answering ? 'Yanıtla' : 'Yorum / Güncelleme')+'</label>'
            + '<textarea id="cmtInput"'+(answering ? ' data-answer="1" placeholder="İstenen bilgiyi yazın..."' : ' placeholder="Durum güncellemesi veya yanıt yazın..."')+'></textarea></div>'
            + (typeof attachPicker === 'function' ? attachPicker('comment') : '')
            + '<button class="btn '+(answering ? 'btn-primary' : 'btn-soft')+'" data-act="comment">'+(answering ? 'Yanıtı Gönder' : 'Güncelleme Ekle')+'</button>'
```
- Aksiyon yönlendiricide `if (act === 'status')  return actStatus(r);` satırının altına:
```js
      if (act === 'info' && typeof actInfoRequest === 'function') return actInfoRequest(r);
```

- [ ] **Step 2: Tarayıcıda doğrula**

Yerel sunucuyu yenile. Giriş sayfasından (sol alttaki "Kişi değiştir"):
1. Bir ekip üyesi olarak kendi ekibindeki "Çalışılıyor" bir kaydı aç → "Ek Bilgi İste" görünür, "Durum Güncelle" listesinde "Ek Bilgi Bekleniyor" yok. 4 karakterlik soruyla gönder → "Sorunuzu en az 5 karakterle yazın"; geçerli soruyla gönder → durum "Ek Bilgi Bekleniyor", kutuda "Kaydı açan kişiden ek bilgi bekleniyor: <soru>".
2. Kaydı açan kişi olarak gir → zilde bildirim; kayıtta "Ekip sizden ek bilgi istiyor: <soru>", alan başlığı "Yanıtla", düğme "Yanıtı Gönder". Yanıt yaz, gönder → "Yanıt gönderildi", durum "Çalışılıyor", Süreç Geçmişi'nde "Ek bilgi istendi: …" ve yanıt satırı.
3. Ekip üyesi olarak gir → zilde "… için istenen ek bilgi geldi."
4. Telefon genişliğinde (`resize_window` mobile) düğmeler taşmıyor; konsolda hata yok. Bitince `resize_window` preset desktop.

- [ ] **Step 3: Commit**

```bash
git add public/api-store.js public/index.html
git commit -m "Arayüz: Ek Bilgi İste penceresi, açana soru kutusu ve Yanıtla alanı; durum listesinden Ek Bilgi kalktı

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Rapor şeması ve görünümler

**Files:**
- Create: `prisma/migrations/20261011120000_rapor/migration.sql`
- Test: `tests/integration/rapor.test.ts` (yeni)

**Interfaces:**
- Produces: `rapor.etiket`, `rapor.ekip`, `rapor.kisi`, `rapor.kayit`, `rapor.kayit_adimi`, `rapor.ek_bilgi`, `rapor.yardim_oturumu`, `rapor.yardim_sorgusu`, `rapor.yardim_sonucu` (kolon adları aşağıdaki SQL'de; Task 12'deki `docs/RAPOR.md` bunları birebir anlatır). Zaman kolonları `timestamptz`; sayılar `int`.

- [ ] **Step 1: Başarısız testi yaz**

`tests/integration/rapor.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RecordStatus, Role } from '../../src/domain/enums.js';
import { createDept, createRecord, createUser, makeApp, prisma, resetDb } from './helpers.js';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); });
beforeEach(async () => { await resetDb(); });

const day = 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms);

describe('rapor görünümleri', () => {
  it('kısıtlı kaydın metinleri, anonim kaydın açanı gizlidir; etiketler Türkçe', async () => {
    const t = await createDept('İnsan Kaynakları');
    const c = await createUser({ name: 'Açan' });
    const m = await createUser({ name: 'Sahip', role: Role.TEAM_MEMBER, departmentId: t.id });
    const kisitli = await createRecord({ createdById: c.id, departmentId: t.id, restricted: true, status: RecordStatus.CALISILIYOR, title: 'Gizli konu' });
    const anonim = await createRecord({ createdById: c.id, departmentId: t.id, anonymous: true, title: 'Anonim konu' });
    await prisma.recordEvent.createMany({ data: [
      { recordId: kisitli.id, type: 'COMMENT', text: 'gizli metin', byId: m.id },
      { recordId: anonim.id, type: 'CREATE', text: 'açıldı', byId: c.id },
    ] });
    await prisma.infoRequest.create({ data: {
      recordId: kisitli.id, requestedById: m.id, question: 'gizli soru', statusBefore: 'CALISILIYOR',
      requestedAt: ago(3 * 60 * 60 * 1000), answeredAt: ago(60 * 60 * 1000), answeredById: c.id, answer: 'gizli yanıt',
    } });

    const [k] = await prisma.$queryRaw<{ baslik: string | null; durum: string; acan_id: string | null }[]>`
      SELECT baslik, durum, acan_id FROM rapor.kayit WHERE kayit_id = ${kisitli.id}`;
    expect(k).toEqual({ baslik: null, durum: 'Çalışılıyor', acan_id: c.id });
    const [a] = await prisma.$queryRaw<{ baslik: string; acan_id: string | null }[]>`
      SELECT baslik, acan_id FROM rapor.kayit WHERE kayit_id = ${anonim.id}`;
    expect(a).toEqual({ baslik: 'Anonim konu', acan_id: null });

    const adim = await prisma.$queryRaw<{ kayit_id: string; metin: string | null; yapan_id: string | null }[]>`
      SELECT kayit_id, metin, yapan_id FROM rapor.kayit_adimi ORDER BY kayit_id`;
    expect(adim.find((x) => x.kayit_id === kisitli.id)).toMatchObject({ metin: null, yapan_id: m.id });
    expect(adim.find((x) => x.kayit_id === anonim.id)).toMatchObject({ metin: 'açıldı', yapan_id: null });

    const [e] = await prisma.$queryRaw<{ soru: string | null; yanit: string | null; sonuc: string; sn: number }[]>`
      SELECT soru, yanit, sonuc, extract(epoch FROM bekleme_suresi)::int AS sn FROM rapor.ek_bilgi`;
    expect(e).toEqual({ soru: null, yanit: null, sonuc: 'yanıtlandı', sn: 7200 });
  });

  it('yardım oturumu: öneri, beyan ve sonraki kayıtlar; anonim sonraki kayıt sayılmaz', async () => {
    const t = await createDept('Bilgi Teknolojileri');
    const t2 = await createDept('Finans');
    const u = await createUser({ name: 'Çalışan' });
    const s = await prisma.helpSession.create({ data: { userId: u.id, channel: 'YENI_KAYIT', startedAt: ago(3 * day), lastActivityAt: ago(3 * day) } });
    const q = await prisma.helpQuery.create({ data: { sessionId: s.id, kind: 'ML_TARAMA', at: ago(3 * day), resultCount: 1, predictedTeamId: t.id, title: 'VPN' } });
    await prisma.helpResult.create({ data: { queryId: q.id, rank: 1, source: 'KAYIT', helpfulAt: ago(3 * day) } });

    const gizli = await createRecord({ createdById: u.id, departmentId: t.id, anonymous: true });
    await prisma.record.update({ where: { id: gizli.id }, data: { createdAt: ago(2 * day) } });
    const baska = await createRecord({ createdById: u.id, departmentId: t2.id });
    await prisma.record.update({ where: { id: baska.id }, data: { createdAt: ago(1.5 * day) } });
    const ayni = await createRecord({ createdById: u.id, departmentId: t.id });
    await prisma.record.update({ where: { id: ayni.id }, data: { createdAt: ago(1 * day) } });

    const [o] = await prisma.$queryRaw<{
      sorgu_sayisi: number; tarama_sayisi: number; oneri_gosterildi: boolean; isime_yaradi_beyani: boolean;
      kayit_acildi: boolean; onerilen_ekip_id: string; sonraki_kayit_zamani: Date; sonraki_ayni_ekip_kaydi_zamani: Date;
    }[]>`SELECT * FROM rapor.yardim_oturumu WHERE oturum_id = ${s.id}`;
    expect(o).toMatchObject({
      sorgu_sayisi: 1, tarama_sayisi: 1, oneri_gosterildi: true, isime_yaradi_beyani: true,
      kayit_acildi: false, onerilen_ekip_id: t.id,
    });
    expect(Math.abs(o!.sonraki_kayit_zamani.getTime() - ago(1.5 * day).getTime())).toBeLessThan(5000);
    expect(Math.abs(o!.sonraki_ayni_ekip_kaydi_zamani.getTime() - ago(1 * day).getTime())).toBeLessThan(5000);

    const sonuc = await prisma.$queryRaw<{ kaynak: string; isime_yaradi_zamani: Date | null }[]>`
      SELECT kaynak, isime_yaradi_zamani FROM rapor.yardim_sonucu`;
    expect(sonuc[0]!.kaynak).toBe('Çözülmüş kayıt');
    expect(sonuc[0]!.isime_yaradi_zamani).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `npx vitest run tests/integration/rapor.test.ts`
Expected: FAIL — `relation "rapor.kayit" does not exist`.

- [ ] **Step 3: Göçü yaz**

`prisma/migrations/20261011120000_rapor/migration.sql`:

```sql
-- Rapor katmanı (docs/RAPOR.md). Prisma bu şemayı yönetmez. Görünümler
-- uygulama hesabının yetkisiyle çalışır; rapor kullanıcısı yalnızca bu şemayı okur.
CREATE SCHEMA IF NOT EXISTS rapor;

CREATE TABLE rapor.etiket (
  alan   text NOT NULL,
  kod    text NOT NULL,
  etiket text NOT NULL,
  PRIMARY KEY (alan, kod)
);
INSERT INTO rapor.etiket (alan, kod, etiket) VALUES
  ('durum', 'YENI', 'Yeni'), ('durum', 'UZERIME_ALINDI', 'Sahiplenildi'), ('durum', 'INCELENIYOR', 'İnceleniyor'),
  ('durum', 'CALISILIYOR', 'Çalışılıyor'), ('durum', 'EK_BILGI', 'Ek Bilgi Bekleniyor'), ('durum', 'COZULDU', 'Çözüldü'),
  ('durum', 'KAPATILDI', 'Kapatıldı'), ('durum', 'REDDEDILDI', 'Reddedildi'), ('durum', 'DEGERLENDIRILIYOR', 'Değerlendiriliyor'),
  ('durum', 'DEGERLENDIRILDI', 'Değerlendirildi'), ('durum', 'FAYDA_SAGLADI', 'Fayda Sağladı'), ('durum', 'UYGUN_BULUNMADI', 'Uygun Bulunmadı'),
  ('tur', 'BILGI', 'Bilgi talebi'), ('tur', 'ONERI', 'Öneri'),
  ('oncelik', 'NORMAL', 'Normal'), ('oncelik', 'YUKSEK', 'Yüksek'), ('oncelik', 'KRITIK', 'Kritik'),
  ('rol', 'USER', 'Çalışan'), ('rol', 'TEAM_MEMBER', 'Ekip üyesi'), ('rol', 'MANAGER', 'Ekip yöneticisi'), ('rol', 'ADMIN', 'Sistem yöneticisi'),
  ('kanal', 'YENI_KAYIT', 'Yeni Kayıt'), ('kanal', 'KAYNAK_BUL', 'Kaynak Bul'), ('kanal', 'ASISTAN', 'Asistan'),
  ('sorgu_turu', 'ML_TARAMA', 'ML taraması'), ('sorgu_turu', 'ARAMA', 'Arama'), ('sorgu_turu', 'ASISTAN', 'Asistan sorusu'),
  ('kaynak', 'KAYIT', 'Çözülmüş kayıt'), ('kaynak', 'BILGI_BANKASI', 'Bilgi Bankası'), ('kaynak', 'CORTEX', 'Kurumsal kaynak'),
  ('adim_turu', 'CREATE', 'Açılış'), ('adim_turu', 'ASSIGN', 'Üstlenme / paylaşım'), ('adim_turu', 'FORWARD', 'Yönlendirme'),
  ('adim_turu', 'STATUS', 'Durum değişikliği'), ('adim_turu', 'COMMENT', 'Güncelleme'), ('adim_turu', 'ATTACH', 'Dosya'),
  ('adim_turu', 'SLA_BREACH', 'Hedef süre aşımı'), ('adim_turu', 'REOPEN', 'Yeniden açılma'), ('adim_turu', 'LEARN', 'Önerilere ekleme'),
  ('adim_turu', 'INFO_REQUEST', 'Ek bilgi isteği'), ('adim_turu', 'INFO_RESPONSE', 'Ek bilgi yanıtı'),
  ('adim_turu', 'INFO_CANCEL', 'Ek bilgi isteği kapandı');

-- Ekip: alt birimi olmayan birim (ekibi olmayan departman kendisi ekiptir).
CREATE VIEW rapor.ekip AS
SELECT d."id" AS ekip_id, d."name" AS ekip,
       COALESCE(p."id", d."id") AS departman_id, COALESCE(p."name", d."name") AS departman,
       d."active" AS aktif
FROM "Department" d
LEFT JOIN "Department" p ON p."id" = d."parentId"
WHERE NOT EXISTS (SELECT 1 FROM "Department" c WHERE c."parentId" = d."id");

CREATE VIEW rapor.kisi AS
SELECT u."id" AS kisi_id, u."name" AS ad, u."email" AS eposta, u."departmentId" AS ekip_id,
       COALESCE(e.etiket, u."role") AS rol, u."role" AS rol_kod, u."active" AS aktif
FROM "User" u
LEFT JOIN rapor.etiket e ON e.alan = 'rol' AND e.kod = u."role";

CREATE VIEW rapor.kayit AS
SELECT r."id" AS kayit_id, r."code" AS kod,
       COALESCE(et.etiket, r."type") AS tur, r."type" AS tur_kod,
       CASE WHEN r."restricted" THEN NULL ELSE r."title" END AS baslik,
       CASE WHEN r."restricted" THEN NULL ELSE r."description" END AS aciklama,
       COALESCE(eo.etiket, r."priority") AS oncelik, r."priority" AS oncelik_kod,
       COALESCE(ed.etiket, r."status") AS durum, r."status" AS durum_kod,
       r."departmentId" AS ekip_id, r."department2Id" AS ekip2_id,
       CASE WHEN r."anonymous" THEN NULL ELSE r."createdById" END AS acan_id,
       r."assigneeId" AS sahip_id, r."anonymous" AS anonim, r."restricted" AS kisitli,
       r."createdAt" AT TIME ZONE 'UTC' AS acilis,
       r."firstResponseAt" AT TIME ZONE 'UTC' AS ilk_donus,
       r."resolvedAt" AT TIME ZONE 'UTC' AS cozulme,
       r."closedAt" AT TIME ZONE 'UTC' AS kapanis,
       hs."id" AS oturum_id
FROM "Record" r
LEFT JOIN rapor.etiket et ON et.alan = 'tur' AND et.kod = r."type"
LEFT JOIN rapor.etiket eo ON eo.alan = 'oncelik' AND eo.kod = r."priority"
LEFT JOIN rapor.etiket ed ON ed.alan = 'durum' AND ed.kod = r."status"
LEFT JOIN "HelpSession" hs ON hs."recordId" = r."id";

CREATE VIEW rapor.kayit_adimi AS
SELECT e."id" AS adim_id, e."recordId" AS kayit_id, e."at" AT TIME ZONE 'UTC' AS zaman,
       COALESCE(et.etiket, e."type") AS tur, e."type" AS tur_kod,
       COALESCE(ef.etiket, e."fromStatus") AS onceki_durum, e."fromStatus" AS onceki_durum_kod,
       COALESCE(es.etiket, e."toStatus") AS sonraki_durum, e."toStatus" AS sonraki_durum_kod,
       e."toTeamId" AS hedef_ekip_id, e."toUserId" AS hedef_kisi_id,
       CASE WHEN r."anonymous" AND e."byId" = r."createdById" THEN NULL ELSE e."byId" END AS yapan_id,
       CASE WHEN r."restricted" THEN NULL ELSE e."text" END AS metin
FROM "RecordEvent" e
JOIN "Record" r ON r."id" = e."recordId"
LEFT JOIN rapor.etiket et ON et.alan = 'adim_turu' AND et.kod = e."type"
LEFT JOIN rapor.etiket ef ON ef.alan = 'durum' AND ef.kod = e."fromStatus"
LEFT JOIN rapor.etiket es ON es.alan = 'durum' AND es.kod = e."toStatus";

CREATE VIEW rapor.ek_bilgi AS
SELECT i."id" AS istek_id, i."recordId" AS kayit_id, i."requestedById" AS isteyen_id,
       i."requestedAt" AT TIME ZONE 'UTC' AS istek_zamani,
       CASE WHEN r."restricted" THEN NULL ELSE i."question" END AS soru,
       CASE WHEN r."anonymous" AND i."answeredById" = r."createdById" THEN NULL ELSE i."answeredById" END AS yanitlayan_id,
       i."answeredAt" AT TIME ZONE 'UTC' AS yanit_zamani,
       CASE WHEN r."restricted" THEN NULL ELSE i."answer" END AS yanit,
       i."cancelledAt" AT TIME ZONE 'UTC' AS iptal_zamani,
       CASE WHEN i."answeredAt" IS NOT NULL THEN 'yanıtlandı'
            WHEN i."cancelledAt" IS NOT NULL THEN 'iptal'
            ELSE 'bekliyor' END AS sonuc,
       COALESCE(i."answeredAt", i."cancelledAt") - i."requestedAt" AS bekleme_suresi
FROM "InfoRequest" i
JOIN "Record" r ON r."id" = i."recordId";

CREATE VIEW rapor.yardim_sorgusu AS
SELECT q."id" AS sorgu_id, q."sessionId" AS oturum_id, q."at" AT TIME ZONE 'UTC' AS zaman,
       COALESCE(ek.etiket, q."kind") AS tur, q."kind" AS tur_kod,
       q."title" AS baslik, q."text" AS metin, q."recordType" AS kayit_turu_kod,
       q."selectedTeamId" AS secili_ekip_id, q."predictedTeamId" AS onerilen_ekip_id,
       q."confidence" AS guven, q."lowConfidence" AS dusuk_guven,
       q."resultCount" AS sonuc_sayisi, q."durationMs" AS sure_ms, q."mlInferenceId" AS ml_calistirma_id
FROM "HelpQuery" q
LEFT JOIN rapor.etiket ek ON ek.alan = 'sorgu_turu' AND ek.kod = q."kind";

CREATE VIEW rapor.yardim_sonucu AS
SELECT s."id" AS sonuc_id, s."queryId" AS sorgu_id, s."rank"::int AS sira,
       COALESCE(ek.etiket, s."source") AS kaynak, s."source" AS kaynak_kod,
       r."code" AS kayit_kodu, k."seq" AS bb_madde_no, s."externalUrl" AS baglanti,
       COALESCE(r."title", k."title", s."externalTitle") AS baslik,
       s."similarity"::int AS benzerlik,
       s."openedAt" AT TIME ZONE 'UTC' AS acildi_zamani,
       s."helpfulAt" AT TIME ZONE 'UTC' AS isime_yaradi_zamani
FROM "HelpResult" s
LEFT JOIN "Record" r ON r."id" = s."recordId"
LEFT JOIN "KbArticle" k ON k."id" = s."kbArticleId"
LEFT JOIN rapor.etiket ek ON ek.alan = 'kaynak' AND ek.kod = s."source";

-- Kayıt önleme: bir satır = bir tekil yardım oturumu. Takip penceresi sorguda verilir (docs/RAPOR.md).
CREATE VIEW rapor.yardim_oturumu AS
WITH q AS (
  SELECT "sessionId",
         count(*)::int AS sorgu_sayisi,
         (count(*) FILTER (WHERE "kind" IN ('ML_TARAMA', 'ASISTAN')))::int AS tarama_sayisi,
         bool_or("kind" IN ('ML_TARAMA', 'ASISTAN') AND "resultCount" > 0) AS oneri_gosterildi
  FROM "HelpQuery" GROUP BY "sessionId"
), h AS (
  SELECT hq."sessionId",
         bool_or(s."helpfulAt" IS NOT NULL) AS isime_yaradi,
         bool_or(s."openedAt" IS NOT NULL) AS sonuc_acildi
  FROM "HelpResult" s JOIN "HelpQuery" hq ON hq."id" = s."queryId"
  GROUP BY hq."sessionId"
), son AS (
  SELECT DISTINCT ON ("sessionId") "sessionId", "predictedTeamId"
  FROM "HelpQuery" WHERE "predictedTeamId" IS NOT NULL
  ORDER BY "sessionId", "at" DESC
)
SELECT o."id" AS oturum_id, o."userId" AS kisi_id,
       COALESCE(ek.etiket, o."channel") AS kanal, o."channel" AS kanal_kod,
       o."startedAt" AT TIME ZONE 'UTC' AS baslangic,
       o."lastActivityAt" AT TIME ZONE 'UTC' AS son_hareket,
       COALESCE(q.sorgu_sayisi, 0) AS sorgu_sayisi,
       COALESCE(q.tarama_sayisi, 0) AS tarama_sayisi,
       COALESCE(q.oneri_gosterildi, false) AS oneri_gosterildi,
       COALESCE(h.isime_yaradi, false) AS isime_yaradi_beyani,
       COALESCE(h.sonuc_acildi, false) AS sonuc_acildi,
       o."recordId" AS kayit_id, r."code" AS kayit_kodu, o."recordId" IS NOT NULL AS kayit_acildi,
       son."predictedTeamId" AS onerilen_ekip_id,
       -- Anonim kayıtlar sayılmaz: zamanı rapor.kayit ile eşleştirilip açan bulunurdu.
       (SELECT min(x."createdAt") FROM "Record" x
         WHERE x."createdById" = o."userId" AND NOT x."anonymous"
           AND x."createdAt" > o."startedAt" AND x."id" IS DISTINCT FROM o."recordId"
       ) AT TIME ZONE 'UTC' AS sonraki_kayit_zamani,
       (SELECT min(x."createdAt") FROM "Record" x
         WHERE x."createdById" = o."userId" AND NOT x."anonymous"
           AND x."createdAt" > o."startedAt" AND x."id" IS DISTINCT FROM o."recordId"
           AND (x."departmentId" = son."predictedTeamId" OR x."department2Id" = son."predictedTeamId")
       ) AT TIME ZONE 'UTC' AS sonraki_ayni_ekip_kaydi_zamani
FROM "HelpSession" o
LEFT JOIN q ON q."sessionId" = o."id"
LEFT JOIN h ON h."sessionId" = o."id"
LEFT JOIN son ON son."sessionId" = o."id"
LEFT JOIN "Record" r ON r."id" = o."recordId"
LEFT JOIN rapor.etiket ek ON ek.alan = 'kanal' AND ek.kod = o."channel";

-- Rapor kullanıcısı önceden oluşturulduysa yeni görünümleri de okusun.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ichatlar_rapor') THEN
    GRANT USAGE ON SCHEMA rapor TO ichatlar_rapor;
    GRANT SELECT ON ALL TABLES IN SCHEMA rapor TO ichatlar_rapor;
  END IF;
END $$;
```

- [ ] **Step 4: Göçü uygula ve testleri çalıştır**

Run:
```bash
npx prisma migrate deploy
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script
npx vitest run tests/integration/rapor.test.ts
```
Expected: deploy başarılı; diff boş (rapor şeması Prisma'nın kapsamı dışında); test PASS (2 test).

Gerçek veriyle görünümleri dene:
```bash
npx tsx -e "import { prisma } from './src/db.ts'; for (const v of ['ekip','kisi','kayit','kayit_adimi','ek_bilgi','yardim_oturumu','yardim_sorgusu','yardim_sonucu']) console.log(v, (await prisma.\$queryRawUnsafe('SELECT count(*)::int n FROM rapor.' + v))[0]); await prisma.\$disconnect();"
```
Expected: her görünüm hata vermeden bir sayı döner.

- [ ] **Step 5: Commit**

```bash
git add prisma/migrations/20261011120000_rapor tests/integration/rapor.test.ts
git commit -m "Rapor şeması: etiket sözlüğü ve kayıt, adım, ek bilgi, yardım oturumu/sorgu/sonuç görünümleri; kısıtlı ve anonim gizli

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Rapor kullanıcısı betiği ve belgeler

**Files:**
- Create: `deploy/windows/rapor-kullanicisi.ps1` (UTF-8 BOM)
- Modify: `deploy/windows/kur.ps1` (sondaki özet)
- Create: `docs/RAPOR.md`
- Modify: `README.md`, `docs/KURULUM.md`

- [ ] **Step 1: Betiği yaz**

`deploy/windows/rapor-kullanicisi.ps1` (dosyayı **UTF-8 BOM** ile kaydet; PowerShell 5.1 BOM'suz Türkçeyi bozuyor):

```powershell
<#
.SYNOPSIS
  Rapor araçları için salt okunur PostgreSQL kullanıcısı (ichatlar_rapor).
.DESCRIPTION
  Kullanıcı yalnızca "rapor" şemasındaki görünümleri okur (docs\RAPOR.md); ham
  tablolara erişimi yoktur. Yoksa oluşturur, varsa parolasını yeniler ve
  bağlantı bilgisini ekrana yazar. Kurulum klasöründen, göçler uygulandıktan
  sonra çalıştırın.
.EXAMPLE
  .\deploy\windows\rapor-kullanicisi.ps1
#>
[CmdletBinding()]
param(
  [string]$PgYonetici = 'postgres',
  [string]$Kullanici = 'ichatlar_rapor'
)

. (Join-Path $PSScriptRoot 'ortak.ps1')
Set-Location $Kok
if ($Kullanici -notmatch '^[a-z_][a-z0-9_]{0,62}$') { throw 'Kullanıcı adı küçük harf, rakam ve _ olmalı.' }

$e = EnvOku
$db = VeritabaniBilgisi $e['DATABASE_URL']
$psql = PgAraci 'psql'

$b = New-Object byte[] 18
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
$parola = -join ($b | ForEach-Object { $_.ToString('x2') })

$sifre = Read-Host "PostgreSQL '$PgYonetici' kullanıcısının parolası" -AsSecureString
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sifre))
try {
  $sql = @"
DO `$`$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$Kullanici') THEN
    CREATE ROLE $Kullanici LOGIN PASSWORD '$parola';
  ELSE
    ALTER ROLE $Kullanici WITH LOGIN PASSWORD '$parola';
  END IF;
END `$`$;
ALTER ROLE $Kullanici SET timezone = 'Europe/Istanbul';
ALTER ROLE $Kullanici SET default_transaction_read_only = on;
GRANT CONNECT ON DATABASE $($db.Ad) TO $Kullanici;
GRANT USAGE ON SCHEMA rapor TO $Kullanici;
GRANT SELECT ON ALL TABLES IN SCHEMA rapor TO $Kullanici;
ALTER DEFAULT PRIVILEGES FOR ROLE $($db.Kullanici) IN SCHEMA rapor GRANT SELECT ON TABLES TO $Kullanici;
"@
  $sql | & $psql -h $db.Sunucu -p $db.Port -U $PgYonetici -d $db.Ad -v ON_ERROR_STOP=1 -q
  if ($LASTEXITCODE -ne 0) { throw 'psql hata verdi; rapor şeması var mı (göçler uygulandı mı)?' }
} finally {
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host 'Rapor kullanıcısı hazır (yalnızca rapor şemasını okur):'
Write-Host "  Sunucu:     $($db.Sunucu):$($db.Port)"
Write-Host "  Veritabanı: $($db.Ad)"
Write-Host "  Kullanıcı:  $Kullanici"
Write-Host "  Parola:     $parola"
Write-Host 'Parolayı rapor aracına girip bu pencereyi kapatın; bir yere kaydedilmedi. Yeniden çalıştırmak parolayı yeniler.'
```

`deploy/windows/kur.ps1` dosyasının sonundaki özet `Write-Host` satırlarının arasına (kurulum tamamlandı mesajının hemen altına) ekle:
```powershell
Write-Host 'Rapor aracı bağlanacaksa salt okunur kullanıcı için: .\deploy\windows\rapor-kullanicisi.ps1 (docs\RAPOR.md)'
```

BOM ve sözdizimi denetimi:
```bash
powershell -NoProfile -Command "[IO.File]::ReadAllBytes('deploy/windows/rapor-kullanicisi.ps1')[0..2] -join ','; \$null = [Management.Automation.Language.Parser]::ParseFile((Resolve-Path 'deploy/windows/rapor-kullanicisi.ps1'), [ref]\$null, [ref]\$e); \$e.Count; \$null = [Management.Automation.Language.Parser]::ParseFile((Resolve-Path 'deploy/windows/kur.ps1'), [ref]\$null, [ref]\$e2); \$e2.Count"
```
Expected: `239,187,191`, `0`, `0`.

- [ ] **Step 2: `docs/RAPOR.md`'yi yaz**

```markdown
# Rapor verisi

Kayıt önleme, ek bilgi ve kayıt adımları PostgreSQL'de tutulur; raporlar
dışarıdaki bir araçla (Power BI, Excel, SQL istemcisi) `rapor` şemasından
okunur. Uygulamada rapor ekranı yoktur.

## Bağlantı

Sunucuda bir kez: `.\deploy\windows\rapor-kullanicisi.ps1` (bkz. KURULUM.md).
Betik `ichatlar_rapor` kullanıcısını oluşturur ve parolasını bir kez gösterir.

- Yalnızca `rapor` şemasını okur; uygulama tablolarına erişemez, yazamaz.
- Zamanlar İstanbul saatiyle döner (`timestamptz`).
- Kısıtlı kayıtların ("Yalnızca ilgili ekip görsün") başlık, açıklama, adım
  metni, ek bilgi soru/yanıtı boştur. Anonim kayıtların açanı ve açanın
  adımlarındaki kişi boştur.
- Yardım oturumları sürüm kurulduğu günden itibaren tutulur; öncesi yoktur.

## Tanımlar

- **Yardım oturumu (tekil oturum):** Bir kişinin ardışık yardım adımları.
  30 dakika hareketsizlik ya da kayıt açılması oturumu kapatır. "İşime
  yaradı" ile form kapanınca da yeni oturum başlar.
- **Kanal:** Oturumun başladığı yer — Yeni Kayıt, Kaynak Bul, Asistan.
- **Sorgu:** Oturumdaki bir ML taraması, arama ya da asistan sorusu. Yazarken
  kendiliğinden yenilenen tarama ve aramalar tek sorgu satırında güncellenir.
- **Çözüm önerilen oturum:** En az bir sonucun gösterildiği ML taraması ya da
  asistan sorusu içeren oturum (`oneri_gosterildi`).
- **İşe yaradı (varsayılan tanım):** Çözüm önerilen, kayda dönüşmeyen
  (`kayit_acildi = false`) ve takip penceresinde aynı kişinin önerilen ekibe
  kaydı olmayan oturum. "Bu çözüm işime yaradı" diyenler (`isime_yaradi_beyani`)
  bunun açık beyanlı alt kümesidir.

## Görünümler

### rapor.yardim_oturumu — bir satır = bir tekil yardım oturumu

| Kolon | Anlamı |
|---|---|
| oturum_id | Oturum |
| kisi_id | Kişi (`rapor.kisi`); anonim kayıtla biten oturumda boş |
| kanal, kanal_kod | Başladığı yer |
| baslangic, son_hareket | İlk ve son adım zamanı |
| sorgu_sayisi, tarama_sayisi | Bütün sorgular; ML taraması + asistan soruları |
| oneri_gosterildi | En az bir taramada sonuç gösterildi |
| isime_yaradi_beyani | Bir sonuca "Bu çözüm işime yaradı" denildi |
| sonuc_acildi | Bir sonucun bağlantısına tıklandı |
| kayit_id, kayit_kodu, kayit_acildi | Bu oturumdan açılan kayıt |
| onerilen_ekip_id | Son taramada ML'in önerdiği ekip (`rapor.ekip`) |
| sonraki_kayit_zamani | Oturum başladıktan sonra aynı kişinin açtığı ilk kayıt (bu oturumun kaydı ve anonim kayıtlar hariç) |
| sonraki_ayni_ekip_kaydi_zamani | Aynısı, yalnızca önerilen ekibe açılmış kayıtlar |

### rapor.yardim_sorgusu — bir satır = bir sorgu

`sorgu_id`, `oturum_id`, `zaman`, `tur` (ML taraması / Arama / Asistan sorusu), `tur_kod`,
`baslik` (Yeni Kayıt başlığı), `metin` (açıklama / arama sözcükleri / asistan sorusu),
`kayit_turu_kod` (BILGI/ONERI), `secili_ekip_id` (formda seçili ekip), `onerilen_ekip_id`,
`guven` (0–1), `dusuk_guven`, `sonuc_sayisi`, `sure_ms`, `ml_calistirma_id` (ML veritabanındaki çalıştırma).

### rapor.yardim_sonucu — bir satır = gösterilen bir sonuç

`sonuc_id`, `sorgu_id`, `sira`, `kaynak` (Çözülmüş kayıt / Bilgi Bankası / Kurumsal kaynak),
`kaynak_kod`, `kayit_kodu`, `bb_madde_no`, `baglanti`, `baslik`, `benzerlik` (yüzde),
`acildi_zamani` (ilk tıklama), `isime_yaradi_zamani`.

### rapor.kayit — bir satır = bir kayıt

`kayit_id`, `kod`, `tur`, `baslik`, `aciklama`, `oncelik`, `durum` (+ `_kod` kolonları),
`ekip_id`, `ekip2_id`, `acan_id`, `sahip_id`, `anonim`, `kisitli`,
`acilis`, `ilk_donus`, `cozulme`, `kapanis`, `oturum_id` (açıldığı yardım oturumu).

### rapor.kayit_adimi — bir satır = kaydın bir adımı

`adim_id`, `kayit_id`, `zaman`, `tur` (Açılış, Üstlenme / paylaşım, Yönlendirme, Durum değişikliği,
Güncelleme, Ek bilgi isteği/yanıtı…), `onceki_durum`, `sonraki_durum` (+ `_kod`),
`hedef_ekip_id`, `hedef_kisi_id`, `yapan_id`, `metin`.
Durum değiştirmeyen adımlarda önceki/sonraki durum boştur. Bu sürümden önceki
adımlarda yalnızca eski kayıttan çıkarılabilenler doludur.

### rapor.ek_bilgi — bir satır = bir ek bilgi isteği

`istek_id`, `kayit_id`, `isteyen_id`, `istek_zamani`, `soru`, `yanitlayan_id`, `yanit_zamani`,
`yanit`, `iptal_zamani`, `sonuc` (yanıtlandı / iptal / bekliyor),
`bekleme_suresi` (yanıt ya da iptale kadar; bekleyenlerde boş).

### rapor.ekip, rapor.kisi, rapor.etiket

`rapor.ekip`: `ekip_id`, `ekip`, `departman_id`, `departman`, `aktif`.
`rapor.kisi`: `kisi_id`, `ad`, `eposta`, `ekip_id`, `rol`, `rol_kod`, `aktif`.
`rapor.etiket`: `alan`, `kod`, `etiket` — görünümlerdeki Türkçe etiketlerin sözlüğü.

## Örnek sorgular

Kayıt önleme oranı, haftalık, takip penceresi 7 gün:

```sql
WITH o AS (
  SELECT date_trunc('week', baslangic) AS hafta, *,
         NOT kayit_acildi
           AND (sonraki_ayni_ekip_kaydi_zamani IS NULL
                OR sonraki_ayni_ekip_kaydi_zamani > son_hareket + interval '7 days') AS onlendi
  FROM rapor.yardim_oturumu
  WHERE oneri_gosterildi
)
SELECT hafta,
       count(*) AS cozum_onerilen_oturum,
       count(*) FILTER (WHERE onlendi) AS onlenen_oturum,
       round(100.0 * count(*) FILTER (WHERE onlendi) / nullif(count(*), 0), 1) AS onleme_orani_yuzde,
       count(DISTINCT kisi_id) FILTER (WHERE onlendi) AS yararlanan_kisi,
       count(*) FILTER (WHERE onlendi AND isime_yaradi_beyani) AS acik_beyanli
FROM o
GROUP BY hafta
ORDER BY hafta;
```

Kim kaç kez yararlandı (son 30 gün):

```sql
SELECT k.ad, e.ekip, count(*) AS onlenen_oturum
FROM rapor.yardim_oturumu o
JOIN rapor.kisi k ON k.kisi_id = o.kisi_id
LEFT JOIN rapor.ekip e ON e.ekip_id = k.ekip_id
WHERE o.oneri_gosterildi AND NOT o.kayit_acildi
  AND (o.sonraki_ayni_ekip_kaydi_zamani IS NULL OR o.sonraki_ayni_ekip_kaydi_zamani > o.son_hareket + interval '7 days')
  AND o.baslangic > now() - interval '30 days'
GROUP BY k.ad, e.ekip
ORDER BY onlenen_oturum DESC;
```

Ek bilgi bekleme süresi, ekip bazında:

```sql
SELECT e.ekip, count(*) AS istek,
       count(*) FILTER (WHERE b.sonuc = 'yanıtlandı') AS yanitlanan,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY b.bekleme_suresi) AS medyan_bekleme
FROM rapor.ek_bilgi b
JOIN rapor.kayit r ON r.kayit_id = b.kayit_id
JOIN rapor.ekip e ON e.ekip_id = r.ekip_id
GROUP BY e.ekip
ORDER BY istek DESC;
```

Bir kaydın durumlarda geçirdiği süre:

```sql
SELECT kayit_id, sonraki_durum AS durum, zaman AS giris,
       lead(zaman) OVER (PARTITION BY kayit_id ORDER BY zaman) - zaman AS sure
FROM rapor.kayit_adimi
WHERE sonraki_durum IS NOT NULL
ORDER BY kayit_id, zaman;
```
```

- [ ] **Step 3: README ve KURULUM.md'yi güncelle**

`README.md`:
- Başlık altındaki madde listesine: `- **Rapor verisi (kayıt önleme, ek bilgi, kayıt adımları):** [docs/RAPOR.md](docs/RAPOR.md)`
- "Kayıt aksiyonları" tablosunda `Durum güncelle / ...` satırının altına:
  `| Ek bilgi iste (soru zorunlu) | Kayıt açıkken **sahibi** (ya da sistem yöneticisi). Açanın sonraki güncellemesi yanıttır; kayıt önceki durumuna döner |`
- "Veri modeli notları"na:
  `- Kayıt önleme günlüğü: HelpSession (tekil yardım oturumu) → HelpQuery (tarama/arama/asistan sorusu) → HelpResult (gösterilen sonuç, tıklama, "işime yaradı"). RecordEvent önceki/sonraki durumu ve hedef ekip/kişiyi tipli kolonlarda taşır; meta jsonb. InfoRequest ek bilgi isteği ve yanıtı. Okuma: rapor şeması (docs/RAPOR.md).`
- "Bildirimler" tablosunda `Çözüldü / Reddedildi / Ek bilgi istendi ...` satırının altına:
  `| Ek bilgi geldi | Sahip |`
- API tablosuna:
  `| POST /api/records/:code/info-request | Ek bilgi iste |`
  `| POST /api/help/results/:id | Yardım sonucuna tıklama / işime yaradı / geri al |`
  ve `POST /api/similar` ile `GET /api/search/resources` satırlarına "yardım oturumu (`helpSessionId`) günlüğe yazılır" notu.
- "Doğrulama durumu"nda otomatik testler listesine "kayıt önleme günlüğü, ek bilgi akışı, rapor görünümlerinde gizleme" ekle.

`docs/KURULUM.md`: yedekleme bölümünden sonra yeni bölüm:

```markdown
### Rapor kullanıcısı (isteğe bağlı)

Kayıt önleme ve ek bilgi raporları dışarıdaki bir araçla okunur (docs\RAPOR.md).
Araç uygulamanın kendi veritabanı hesabıyla değil, salt okunur kullanıcıyla bağlanır:

    .\deploy\windows\rapor-kullanicisi.ps1

PostgreSQL yönetici parolasını sorar; `ichatlar_rapor` kullanıcısını oluşturur ve
parolasını **bir kez** gösterir. Kullanıcı yalnızca `rapor` şemasındaki görünümleri
okur, uygulama tablolarına erişemez. Yeniden çalıştırmak parolayı yeniler.
```
ve canlıya geçiş denetim listesine `- [ ] Rapor aracı kullanılacaksa rapor-kullanicisi.ps1 çalıştırıldı` maddesi.

- [ ] **Step 4: Bütün testler, tip denetimi, derleme**

Run: `npm run typecheck && npm test && npm run build`
Expected: hepsi PASS; derleme hatasız.

- [ ] **Step 5: Commit**

```bash
git add deploy/windows/rapor-kullanicisi.ps1 deploy/windows/kur.ps1 docs/RAPOR.md README.md docs/KURULUM.md
git commit -m "Rapor kullanıcısı betiği ve rapor belgesi (kolon sözlüğü, kayıt önleme örnek sorguları)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Bitiş

- [ ] `npm run typecheck && npm test && npm run build` — hepsi geçer.
- [ ] Yerel sunucuyu yeniden başlat; Task 9 ve 10'daki tarayıcı senaryolarını bir kez daha uçtan uca çalıştır, konsolda hata yok.
- [ ] `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` çıktısını rapora yaz (boş ya da yalnızca Prisma'nın bilmediği kısıt/index satırları).
- [ ] Kullanıcıya özet: ne eklendi, gerçek sunucuda denenmeyenler (`rapor-kullanicisi.ps1` gerçek PostgreSQL yöneticisiyle çalıştırılmadı), push yapılmadı.
