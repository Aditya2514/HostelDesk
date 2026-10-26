/*
  Warnings:

  - Added the required column `publicId` to the `attachments` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EventType" ADD VALUE 'CODE_VERIFIED';
ALTER TYPE "EventType" ADD VALUE 'CODE_FAILED';
ALTER TYPE "EventType" ADD VALUE 'PHOTO_ADDED';
ALTER TYPE "EventType" ADD VALUE 'ROOM_LOCKED';
ALTER TYPE "EventType" ADD VALUE 'ACCESS_RESPONDED';
ALTER TYPE "EventType" ADD VALUE 'CONFIRMED';
ALTER TYPE "EventType" ADD VALUE 'DISPUTED';
ALTER TYPE "EventType" ADD VALUE 'WARDEN_VERIFIED';

-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "publicId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "disputes" ADD COLUMN     "decisionNote" TEXT;

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "priorityBoostUntil" TIMESTAMP(3);
