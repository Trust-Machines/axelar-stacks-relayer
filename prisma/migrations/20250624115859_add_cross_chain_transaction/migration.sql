-- CreateTable
CREATE TABLE "CrossChainTransaction" (
    "txHash" VARCHAR(66) NOT NULL,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrossChainTransaction_pkey" PRIMARY KEY ("txHash")
);
