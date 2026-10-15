-- CreateTable
CREATE TABLE "LessonTypeTeacher" (
    "lessonTypeId" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LessonTypeTeacher_pkey" PRIMARY KEY ("lessonTypeId","teacherId")
);

-- CreateIndex
CREATE INDEX "LessonTypeTeacher_teacherId_idx" ON "LessonTypeTeacher"("teacherId");

-- AddForeignKey
ALTER TABLE "LessonTypeTeacher" ADD CONSTRAINT "LessonTypeTeacher_lessonTypeId_fkey" FOREIGN KEY ("lessonTypeId") REFERENCES "LessonType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonTypeTeacher" ADD CONSTRAINT "LessonTypeTeacher_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "TeacherProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
