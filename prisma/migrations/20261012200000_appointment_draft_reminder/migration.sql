-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN "draftReminderAt" TIMESTAMP(3),
ADD COLUMN "draftReminderText" TEXT,
ADD COLUMN "draftReminderSentAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Appointment_draftReminderSentAt_draftReminderAt_idx" ON "Appointment"("draftReminderSentAt", "draftReminderAt");
