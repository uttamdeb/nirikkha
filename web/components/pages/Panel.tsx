"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ApiError,
  apiGet,
  type PanelPage,
  type PanelRow,
} from "@/lib/api";
import { usePrefs } from "@/lib/i18n";
import { MetricTile } from "@/components/metric-tile";
import { ReviewQueueCard } from "@/components/review-queue-card";
import { EmptyState } from "@/components/feedback/empty-state";
import { StatusBadge } from "@/components/feedback/status-badge";
import { LoadingBlock } from "@/components/feedback/loading-block";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  BookOpenIcon,
  BotIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  ClipboardCheckIcon,
  SparklesIcon,
  UsersIcon,
} from "lucide-react";

type SettingsBrief = {
  bot_connected?: boolean;
  bot_username?: string | null;
  publish_mode?: string | null;
  ai_from_env?: boolean;
};

export default function PanelPageView() {
  const { t } = usePrefs();
  const [rows, setRows] = useState<PanelRow[]>([]);
  const [pending, setPending] = useState(0);
  const [examCount, setExamCount] = useState(0);
  const [batchCount, setBatchCount] = useState(0);
  const [settings, setSettings] = useState<SettingsBrief | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [panel, exams, batches, org] = await Promise.all([
          apiGet<PanelPage>(
            "/api/teacher/panel?limit=12&offset=0&status=awaiting_teacher"
          ).catch(() =>
            apiGet<PanelPage>("/api/teacher/panel?limit=12&offset=0")
          ),
          apiGet<{ exams: { id: string }[] }>("/api/teacher/exams").catch(
            () => ({ exams: [] })
          ),
          apiGet<{ batches: { id: string }[] }>("/api/teacher/batches").catch(
            () => ({ batches: [] })
          ),
          apiGet<SettingsBrief>("/api/teacher/settings").catch(() => null),
        ]);
        if (!active) return;

        const queue = [...panel.rows].sort((a, b) => {
          const aNeed =
            a.status === "awaiting_teacher" || a.needs_human_review ? 0 : 1;
          const bNeed =
            b.status === "awaiting_teacher" || b.needs_human_review ? 0 : 1;
          if (aNeed !== bNeed) return aNeed - bNeed;
          return (b.created_at || "").localeCompare(a.created_at || "");
        });

        setRows(queue);
        setPending(
          panel.counts?.awaiting_teacher ??
            queue.filter(
              (r) => r.status === "awaiting_teacher" || r.needs_human_review
            ).length
        );
        setExamCount(exams.exams.length);
        setBatchCount(batches.batches.length);
        setSettings(org);
      } catch (err) {
        if (!active) return;
        setError(err instanceof ApiError ? err.message : t("loadFailed"));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [t]);

  const botOk = Boolean(settings?.bot_connected);
  const aiOk = settings?.ai_from_env !== false;
  const ready = botOk && aiOk;
  const setupDone = [botOk, aiOk].filter(Boolean).length;

  if (loading) return <LoadingBlock rows={5} />;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-6">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-3">
          <MetricTile
            label={t("pendingReview")}
            value={pending}
            hint={t("waitingOnTeacher")}
            icon={<ClipboardCheckIcon className="size-4" />}
            tone={pending > 0 ? "amber" : "default"}
          />
          <MetricTile
            label={t("examsMetric")}
            value={examCount}
            hint={t("examsMetricHint")}
            icon={<BookOpenIcon className="size-4" />}
          />
          <MetricTile
            label={t("batchesMetric")}
            value={batchCount}
            hint={t("batchesMetricHint")}
            icon={<UsersIcon className="size-4" />}
          />
        </div>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="font-heading text-lg font-semibold">
                {t("reviewQueue")}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t("reviewQueueLede")}
              </p>
            </div>
            {pending > 0 ? (
              <StatusBadge
                status="awaiting_teacher"
                label={t("waitingCount", { n: pending })}
              />
            ) : null}
          </div>

          {rows.length === 0 ? (
            <EmptyState
              icon={<ClipboardCheckIcon className="size-5" />}
              title={t("noScriptsYet")}
              description={t("noScriptsYetLede")}
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button asChild>
                    <Link href="/exams/new">{t("createExam")}</Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link href="/submit">{t("navNew")}</Link>
                  </Button>
                </div>
              }
            />
          ) : (
            <ul className="grid gap-3">
              {rows.map((row) => (
                <li key={row.id}>
                  <ReviewQueueCard row={row} href={`/s/${row.id}`} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
        <div
          className={cn(
            "rounded-2xl border p-5",
            ready
              ? "border-teal/30 bg-[color-mix(in_oklch,var(--teal),white_93%)]"
              : "border-border/80 bg-card"
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-2">
            <div>
              <p className="font-heading text-base font-semibold">
                {ready ? t("demoReady") : t("setupChecklist")}
              </p>
              <p className="text-sm text-muted-foreground">
                {ready
                  ? t("aiFromServer")
                  : t("stepsComplete", { n: setupDone })}
              </p>
            </div>
            {ready ? (
              <CheckCircle2Icon className="size-5 text-teal" />
            ) : (
              <CircleAlertIcon className="size-5 text-[color-mix(in_oklch,var(--status-review),black_10%)]" />
            )}
          </div>

          {!ready ? (
            <Progress value={(setupDone / 2) * 100} className="mb-4 h-1.5" />
          ) : null}

          <ul className="space-y-3">
            <ChecklistRow
              done={botOk}
              icon={<BotIcon className="size-3.5" />}
              title={t("telegramBot")}
              detail={
                botOk
                  ? settings?.bot_username
                    ? `@${settings.bot_username}`
                    : t("botConnected")
                  : t("connectWebhookHint")
              }
            />
            <ChecklistRow
              done={aiOk}
              icon={<SparklesIcon className="size-3.5" />}
              title="AI"
              detail={t("aiFromServer")}
            />
          </ul>

          {!ready ? (
            <Button asChild className="mt-5 w-full">
              <Link href="/settings">{t("continueSetup")}</Link>
            </Button>
          ) : null}
        </div>

        <div className="rounded-2xl border border-border/70 bg-card p-5">
          <p className="font-heading mb-3 text-sm font-semibold">
            {t("quickActions")}
          </p>
          <div className="grid gap-2">
            <Button asChild variant="outline" className="justify-start">
              <Link href="/exams/new">
                <BookOpenIcon />
                {t("createExam")}
              </Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link href="/batches">
                <UsersIcon />
                {t("manageBatches")}
              </Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link href="/review">
                <ClipboardCheckIcon />
                {t("allReviews")}
              </Link>
            </Button>
          </div>
        </div>
      </aside>
    </div>
  );
}

function ChecklistRow({
  done,
  icon,
  title,
  detail,
}: {
  done: boolean;
  icon: ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <li className="flex items-start gap-3">
      <span
        className={cn(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full",
          done
            ? "bg-teal text-teal-foreground"
            : "bg-muted text-muted-foreground"
        )}
      >
        {done ? <CheckCircle2Icon className="size-3.5" /> : icon}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
    </li>
  );
}
