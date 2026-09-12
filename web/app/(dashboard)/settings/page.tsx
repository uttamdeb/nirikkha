"use client";

import SettingsPage from "@/components/pages/Settings";
import { TeacherOnly } from "@/components/teacher-only";
import { PageShell } from "@/components/layout/page-shell";
import { usePrefs } from "@/lib/i18n";

export default function SettingsRoute() {
  const { t } = usePrefs();
  return (
    <TeacherOnly>
      <PageShell title={t("settingsTitle")} description={t("settingsLede")}>
        <SettingsPage />
      </PageShell>
    </TeacherOnly>
  );
}
