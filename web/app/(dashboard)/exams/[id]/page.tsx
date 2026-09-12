"use client";

import ExamDetailPage from "@/components/pages/ExamDetail";
import { TeacherOnly } from "@/components/teacher-only";

export default function ExamDetailRoute() {
  return (
    <TeacherOnly>
      <ExamDetailPage />
    </TeacherOnly>
  );
}
