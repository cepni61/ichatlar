-- AlterTable
ALTER TABLE "RecordEvent" ADD COLUMN     "fromStatus" TEXT,
ADD COLUMN     "toStatus" TEXT,
ADD COLUMN     "toTeamId" TEXT,
ADD COLUMN     "toUserId" TEXT;

-- meta metin → jsonb; veri korunur (değerler toJsonText ile yazılmış geçerli JSON).
ALTER TABLE "RecordEvent" ALTER COLUMN "meta" TYPE JSONB USING "meta"::jsonb;

-- CreateTable
CREATE TABLE "HelpSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "channel" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordId" TEXT,

    CONSTRAINT "HelpSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelpQuery" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "title" TEXT,
    "text" TEXT,
    "recordType" TEXT,
    "selectedTeamId" TEXT,
    "predictedTeamId" TEXT,
    "confidence" DOUBLE PRECISION,
    "lowConfidence" BOOLEAN,
    "resultCount" INTEGER NOT NULL,
    "durationMs" INTEGER,
    "mlInferenceId" TEXT,

    CONSTRAINT "HelpQuery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelpResult" (
    "id" TEXT NOT NULL,
    "queryId" TEXT NOT NULL,
    "rank" SMALLINT NOT NULL,
    "source" TEXT NOT NULL,
    "recordId" TEXT,
    "kbArticleId" TEXT,
    "externalUrl" TEXT,
    "externalTitle" TEXT,
    "similarity" SMALLINT,
    "openedAt" TIMESTAMP(3),
    "helpfulAt" TIMESTAMP(3),

    CONSTRAINT "HelpResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InfoRequest" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "requestedById" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "question" TEXT NOT NULL,
    "statusBefore" TEXT NOT NULL,
    "answeredById" TEXT,
    "answeredAt" TIMESTAMP(3),
    "answer" TEXT,
    "answerEventId" TEXT,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "InfoRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HelpSession_recordId_key" ON "HelpSession"("recordId");

-- CreateIndex
CREATE INDEX "HelpSession_userId_startedAt_idx" ON "HelpSession"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "HelpSession_startedAt_idx" ON "HelpSession"("startedAt");

-- CreateIndex
CREATE INDEX "HelpQuery_sessionId_at_idx" ON "HelpQuery"("sessionId", "at");

-- CreateIndex
CREATE INDEX "HelpQuery_at_idx" ON "HelpQuery"("at");

-- CreateIndex
CREATE INDEX "HelpQuery_predictedTeamId_idx" ON "HelpQuery"("predictedTeamId");

-- CreateIndex
CREATE INDEX "HelpResult_queryId_idx" ON "HelpResult"("queryId");

-- CreateIndex
CREATE INDEX "HelpResult_recordId_idx" ON "HelpResult"("recordId");

-- CreateIndex
CREATE INDEX "HelpResult_kbArticleId_idx" ON "HelpResult"("kbArticleId");

-- CreateIndex
CREATE INDEX "InfoRequest_recordId_requestedAt_idx" ON "InfoRequest"("recordId", "requestedAt");

-- CreateIndex
CREATE INDEX "RecordEvent_toStatus_at_idx" ON "RecordEvent"("toStatus", "at");

-- AddForeignKey
ALTER TABLE "RecordEvent" ADD CONSTRAINT "RecordEvent_toTeamId_fkey" FOREIGN KEY ("toTeamId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordEvent" ADD CONSTRAINT "RecordEvent_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpSession" ADD CONSTRAINT "HelpSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpSession" ADD CONSTRAINT "HelpSession_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpQuery" ADD CONSTRAINT "HelpQuery_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "HelpSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpQuery" ADD CONSTRAINT "HelpQuery_selectedTeamId_fkey" FOREIGN KEY ("selectedTeamId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpQuery" ADD CONSTRAINT "HelpQuery_predictedTeamId_fkey" FOREIGN KEY ("predictedTeamId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpResult" ADD CONSTRAINT "HelpResult_queryId_fkey" FOREIGN KEY ("queryId") REFERENCES "HelpQuery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpResult" ADD CONSTRAINT "HelpResult_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpResult" ADD CONSTRAINT "HelpResult_kbArticleId_fkey" FOREIGN KEY ("kbArticleId") REFERENCES "KbArticle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InfoRequest" ADD CONSTRAINT "InfoRequest_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InfoRequest" ADD CONSTRAINT "InfoRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InfoRequest" ADD CONSTRAINT "InfoRequest_answeredById_fkey" FOREIGN KEY ("answeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InfoRequest" ADD CONSTRAINT "InfoRequest_answerEventId_fkey" FOREIGN KEY ("answerEventId") REFERENCES "RecordEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
