-- CreateEnum
CREATE TYPE "ResolutionMethod" AS ENUM ('CODE', 'PHOTO', 'WARDEN');

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "actualWorkMinutes" INTEGER,
ADD COLUMN     "etaNotifiedP50At" TIMESTAMP(3),
ADD COLUMN     "etaP50At" TIMESTAMP(3),
ADD COLUMN     "etaP80At" TIMESTAMP(3),
ADD COLUMN     "isSynthetic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "resolutionMethod" "ResolutionMethod";

-- CreateIndex
CREATE INDEX "tickets_categoryId_blockId_resolutionMethod_idx" ON "tickets"("categoryId", "blockId", "resolutionMethod");
