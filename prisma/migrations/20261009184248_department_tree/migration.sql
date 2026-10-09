-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "parentId" TEXT;

-- CreateIndex
CREATE INDEX "Department_parentId_idx" ON "Department"("parentId");

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
