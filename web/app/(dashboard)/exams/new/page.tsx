"use client";

import ExamNewPage from "@/components/pages/ExamNew";
import { TeacherOnly } from "@/components/teacher-only";
import { PageShell } from "@/components/layout/page-shell";
import { usePrefs } from "@/lib/i18n";

export default function ExamNewRoute() {
  const { t } = usePrefs();
  return (
    <TeacherOnly>
      <PageShell title={t("createExam")} description={t("createExamLede")}>
        <ExamNewPage />
      </PageShell>
    </TeacherOnly>
  );
}
