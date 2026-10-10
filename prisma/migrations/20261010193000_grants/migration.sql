-- Yetkiler tek tabloda: rol yetkisi (User.roleGrant*), Bilgi Bankası
-- düzenleme yetkisi (KbEditor) ve yeni türler (departman sorumlusu, rapor
-- görüntüleyici) süre, veren ve kapsamla birlikte Grant'ta.

-- CreateTable
CREATE TABLE "Grant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "departmentId" TEXT,
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "Grant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Grant_userId_idx" ON "Grant"("userId");

-- CreateIndex
CREATE INDEX "Grant_expiresAt_idx" ON "Grant"("expiresAt");

-- AddForeignKey
ALTER TABLE "Grant" ADD CONSTRAINT "Grant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grant" ADD CONSTRAINT "Grant_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grant" ADD CONSTRAINT "Grant_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Veri aktarımı: eski yetkiler kaybolmasın.
INSERT INTO "Grant" ("id", "userId", "kind", "departmentId", "grantedById", "createdAt")
SELECT 'kb' || "id", "userId", 'KB_EDITOR', "departmentId", "grantedById", "createdAt" FROM "KbEditor";

INSERT INTO "Grant" ("id", "userId", "kind", "grantedById", "createdAt")
SELECT 'rg' || "id", "id", "roleGrant", "roleGrantById", COALESCE("roleGrantAt", CURRENT_TIMESTAMP)
FROM "User" WHERE "roleGrant" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "KbEditor" DROP CONSTRAINT "KbEditor_departmentId_fkey";

-- DropForeignKey
ALTER TABLE "KbEditor" DROP CONSTRAINT "KbEditor_grantedById_fkey";

-- DropForeignKey
ALTER TABLE "KbEditor" DROP CONSTRAINT "KbEditor_userId_fkey";

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_roleGrantById_fkey";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "roleGrant",
DROP COLUMN "roleGrantAt",
DROP COLUMN "roleGrantById";

-- DropTable
DROP TABLE "KbEditor";
