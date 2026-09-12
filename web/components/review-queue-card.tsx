"use client";

import Link from "next/link";
import { StatusBadge } from "@/components/feedback/status-badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { usePrefs, statusKey } from "@/lib/i18n";
import { personName, type PanelRow } from "@/lib/api";

export function ReviewQueueCard({
  row,
  href,
}: {
  row: PanelRow;
  href: string;
}) {
  const { t, lang } = usePrefs();
  const needsReview =
    row.status === "awaiting_teacher" || row.needs_human_review;
  const name = personName(row.student) || "—";
  const initial = name.slice(0, 1).toUpperCase();

  return (
    <Link
      href={href}
      className={cn(
        "bg-paper group flex flex-col gap-4 rounded-2xl border p-4 transition hover:border-teal/40 hover:shadow-sm sm:flex-row sm:items-center",
        needsReview
          ? "border-[color-mix(in_oklch,var(--status-review),white_40%)] shadow-sm"
          : "border-border/70"
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div
          className={cn(
            "mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl font-heading text-sm font-semibold",
            needsReview
              ? "bg-[color-mix(in_oklch,var(--status-review),white_75%)] text-[color-mix(in_oklch,var(--status-review),black_35%)]"
              : "bg-muted text-muted-foreground"
          )}
        >
          {initial}
        </div>
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-heading font-semibold tracking-tight">{name}</p>
            <StatusBadge
              status={row.status}
              label={t(statusKey(row.status, true))}
            />
          </div>
          <p
            className={cn(
              "truncate text-sm text-muted-foreground",
              lang === "bn" && "text-bangla"
            )}
          >
            {row.subject || row.question_text || "—"}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 sm:justify-end">
        {row.total_awarded != null ? (
          <div className="text-right">
            <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
              {t("scoreLabel")}
            </p>
            <p className="font-heading text-lg font-semibold tabular-nums">
              {row.total_awarded}
              <span className="text-sm font-normal text-muted-foreground">
                /{row.total_max}
              </span>
            </p>
          </div>
        ) : null}
        <span className="rounded-lg bg-teal px-3 py-1.5 text-sm font-medium text-teal-foreground opacity-90 transition group-hover:opacity-100">
          {t("openStudio")}
        </span>
      </div>
    </Link>
  );
}

/** Optional OCR bar when confidence is known (0–1). */
export function OcrBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="w-28 space-y-1">
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>OCR</span>
        <span className="tabular-nums">{pct}%</span>
      </div>
      <Progress value={pct} className="h-1.5" />
    </div>
  );
}
