-- AlterTable
ALTER TABLE "Record" ADD COLUMN     "autoCloseAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Record_status_autoCloseAt_idx" ON "Record"("status", "autoCloseAt");

