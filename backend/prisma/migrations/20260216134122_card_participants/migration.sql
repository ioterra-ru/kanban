-- CreateTable
CREATE TABLE "CardParticipant" (
    "cardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardParticipant_pkey" PRIMARY KEY ("cardId","userId")
);

-- CreateIndex
CREATE INDEX "CardParticipant_userId_idx" ON "CardParticipant"("userId");

-- AddForeignKey
ALTER TABLE "CardParticipant" ADD CONSTRAINT "CardParticipant_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardParticipant" ADD CONSTRAINT "CardParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
