"use client";

import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import PanelPageView from "@/components/pages/Panel";
import { TeacherOnly } from "@/components/teacher-only";
import { PageShell } from "@/components/layout/page-shell";
import { usePrefs } from "@/lib/i18n";
import { LoadingBlock } from "@/components/feedback/loading-block";
import { useAuth } from "@/components/providers";

function Home() {
  const { isTeacher, ready, session } = useAuth();
  const router = useRouter();
  const { t } = usePrefs();

  useEffect(() => {
    if (ready && session && !isTeacher) router.replace("/submit");
  }, [ready, session, isTeacher, router]);

  if (!ready || !session || !isTeacher) {
    return (
      <div className="p-8">
        <LoadingBlock />
      </div>
    );
  }

  return (
    <TeacherOnly>
      <PageShell title={t("navPanel")} description={t("panelLede")}>
        <PanelPageView />
      </PageShell>
    </TeacherOnly>
  );
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8">
          <LoadingBlock />
        </div>
      }
    >
      <Home />
    </Suspense>
  );
}
