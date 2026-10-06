-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "eventId" TEXT;

-- CreateIndex
CREATE INDEX "Attachment_eventId_idx" ON "Attachment"("eventId");

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "RecordEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
