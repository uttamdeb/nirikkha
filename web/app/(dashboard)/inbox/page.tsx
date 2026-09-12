"use client";

import InboxPage from "@/components/pages/Inbox";
import { PageShell } from "@/components/layout/page-shell";
import { usePrefs } from "@/lib/i18n";

export default function InboxRoute() {
  const { t } = usePrefs();
  return (
    <PageShell title={t("navMine")}>
      <InboxPage />
    </PageShell>
  );
}
