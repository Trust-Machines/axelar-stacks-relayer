-- AlterTable
ALTER TABLE "MessageApproved" ALTER COLUMN "contractAddress" SET DATA TYPE VARCHAR(255),
ALTER COLUMN "payloadHash" SET DATA TYPE VARCHAR(66),
ALTER COLUMN "executeTxHash" SET DATA TYPE VARCHAR(66);
