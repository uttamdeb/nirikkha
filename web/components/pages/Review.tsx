"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/feedback/empty-state";
import { LoadingBlock } from "@/components/feedback/loading-block";
import { StatusBadge } from "@/components/feedback/status-badge";
import { ApiError, apiGet, type SubmissionSummary } from "@/lib/api";
import { formatDate, statusKey, usePrefs } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export default function ReviewPage() {
  const { t } = usePrefs();
  const [rows, setRows] = useState<SubmissionSummary[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiGet<SubmissionSummary[]>("/api/review-queue")
      .then(setRows)
      .catch((e) => {
        setError(e instanceof ApiError ? e.message : t("loadFailed"));
        setRows([]);
      });
  }, [t]);

  if (!rows) return <LoadingBlock rows={4} className="max-w-none" />;

  const flagged = rows.filter((r) => r.needs_human_review);

  return (
    <div className="space-y-4">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState title={t("reviewTitle")} description={t("queueEmpty")} />
      ) : (
        <>
          {flagged.length > 0 && (
            <Alert>
              <AlertDescription>{t("unsureCount", { n: flagged.length })}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-3">
            {rows.map((row) => (
              <Link
                key={row.id}
                href={`/s/${row.id}`}
                className={cn(
                  "bg-paper group flex flex-col gap-4 rounded-2xl border p-4 transition hover:border-teal/40 hover:shadow-sm sm:flex-row sm:items-center",
                  row.needs_human_review
                    ? "border-[color-mix(in_oklch,var(--status-review),white_40%)] shadow-sm"
                    : "border-border/70"
                )}
              >
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge
                      status="awaiting_teacher"
                      label={t(statusKey("awaiting_teacher", true))}
                    />
                    {row.needs_human_review ? (
                      <Badge variant="outline">
                        {row.review_reason === "grader_uncertain"
                          ? t("agentUnsure")
                          : t("unclearWriting")}
                      </Badge>
                    ) : null}
                  </div>

                  <div className="space-y-1">
                    <p className="truncate font-heading font-semibold tracking-tight">
                      {row.subject || row.question_text.slice(0, 90) || "—"}
                    </p>
                    <p className="line-clamp-2 text-sm text-muted-foreground text-bangla">
                      {row.question_text || "—"}
                    </p>
                    {row.created_at ? (
                      <p className="text-xs text-muted-foreground">
                        {formatDate(row.created_at)}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="flex items-center gap-4 sm:justify-end">
                  <div className="text-right">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {t("tableScore")}
                    </p>
                    <p className="font-heading text-lg font-semibold tabular-nums">
                      {row.total_awarded ?? "—"}
                      <span className="text-sm font-normal text-muted-foreground">
                        /{row.total_max}
                      </span>
                    </p>
                  </div>
                  <span className="rounded-lg bg-teal px-3 py-1.5 text-sm font-medium text-teal-foreground opacity-90 transition group-hover:opacity-100">
                    {t("reviewOpenScript")}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
