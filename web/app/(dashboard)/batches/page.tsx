"use client";

import BatchesPage from "@/components/pages/Batches";
import { TeacherOnly } from "@/components/teacher-only";
import { PageShell } from "@/components/layout/page-shell";
import { usePrefs } from "@/lib/i18n";

export default function BatchesRoute() {
  const { t } = usePrefs();
  return (
    <TeacherOnly>
      <PageShell title={t("batchesTitle")} description={t("batchesLede")}>
        <BatchesPage />
      </PageShell>
    </TeacherOnly>
  );
}
