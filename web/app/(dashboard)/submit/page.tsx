"use client";

import SubmitPage from "@/components/pages/Submit";
import { PageShell } from "@/components/layout/page-shell";
import { usePrefs } from "@/lib/i18n";

export default function SubmitRoute() {
  const { t } = usePrefs();
  return (
    <PageShell title={t("navNew")} description={t("tagline")}>
      <SubmitPage />
    </PageShell>
  );
}
