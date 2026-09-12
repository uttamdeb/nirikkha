"use client";

import ReviewPage from "@/components/pages/Review";
import { TeacherOnly } from "@/components/teacher-only";
import { PageShell } from "@/components/layout/page-shell";
import { usePrefs } from "@/lib/i18n";

export default function ReviewRoute() {
  const { t } = usePrefs();
  return (
    <TeacherOnly>
      <PageShell title={t("navReview")}>
        <ReviewPage />
      </PageShell>
    </TeacherOnly>
  );
}
