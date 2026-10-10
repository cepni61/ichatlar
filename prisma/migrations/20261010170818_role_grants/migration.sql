-- AlterTable
ALTER TABLE "User" ADD COLUMN     "baseRole" TEXT NOT NULL DEFAULT 'USER',
ADD COLUMN     "roleGrant" TEXT,
ADD COLUMN     "roleGrantAt" TIMESTAMP(3),
ADD COLUMN     "roleGrantById" TEXT;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleGrantById_fkey" FOREIGN KEY ("roleGrantById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Mevcut kişilerin bugünkü rolü dizinden/kurulumdan gelmiş sayılır.
UPDATE "User" SET "baseRole" = "role";
