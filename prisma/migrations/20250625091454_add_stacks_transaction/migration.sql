-- CreateEnum
CREATE TYPE "StacksTransactionType" AS ENUM ('GATEWAY', 'REFUND');

-- CreateEnum
CREATE TYPE "StacksTransactionStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "StacksTransaction" (
    "taskItemId" UUID NOT NULL,
    "type" "StacksTransactionType" NOT NULL,
    "status" "StacksTransactionStatus" NOT NULL,
    "extraData" JSONB NOT NULL,
    "txHash" VARCHAR(66),
    "retry" SMALLINT NOT NULL,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "StacksTransaction_taskItemId_key" ON "StacksTransaction"("taskItemId");
