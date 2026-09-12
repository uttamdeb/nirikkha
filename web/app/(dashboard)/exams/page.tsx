"use client";

import ExamsPage from "@/components/pages/Exams";
import { TeacherOnly } from "@/components/teacher-only";
import { PageShell } from "@/components/layout/page-shell";
import { usePrefs } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function ExamsRoute() {
  const { t } = usePrefs();
  return (
    <TeacherOnly>
      <PageShell
        title={t("examsTitle")}
        description={t("examsLede")}
        actions={
          <Button asChild>
            <Link href="/exams/new">{t("createExam")}</Link>
          </Button>
        }
      >
        <ExamsPage />
      </PageShell>
    </TeacherOnly>
  );
}
