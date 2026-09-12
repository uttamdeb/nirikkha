"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/feedback/empty-state";
import { LoadingBlock } from "@/components/feedback/loading-block";
import { StatusBadge } from "@/components/feedback/status-badge";
import { ApiError, apiGet, type SubmissionSummary } from "@/lib/api";
import { formatDate, statusKey, usePrefs } from "@/lib/i18n";

export default function InboxPage() {
  const { t } = usePrefs();
  const [rows, setRows] = useState<SubmissionSummary[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiGet<SubmissionSummary[]>("/api/submissions")
      .then(setRows)
      .catch((e) => {
        setError(e instanceof ApiError ? e.message : t("loadFailed"));
        setRows([]);
      });
  }, [t]);

  if (!rows) return <LoadingBlock rows={4} className="max-w-none" />;

  return (
    <div className="space-y-4">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          title={t("navMine")}
          description={t("inboxEmpty")}
          action={
            <Button asChild>
              <Link href="/">{t("submitFirst")}</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const title = row.subject || row.question_text.trim().split("\n")[0] || t("untitled");
            const when = formatDate(row.created_at);
            return (
              <Link
                key={row.id}
                href={`/s/${row.id}`}
                className="bg-paper flex flex-col gap-3 rounded-2xl border border-border/70 p-4 transition hover:border-teal/40 hover:shadow-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge
                      status={row.status}
                      label={t(statusKey(row.status))}
                    />
                    {row.needs_human_review ? (
                      <Badge variant="outline">{t("navReview")}</Badge>
                    ) : null}
                  </div>

                  <div className="space-y-1">
                    <p className="truncate font-heading font-semibold tracking-tight">
                      {title.slice(0, 80)}
                    </p>
                    <p className="line-clamp-2 text-sm text-muted-foreground text-bangla">
                      {row.question_text || "—"}
                    </p>
                    {when ? (
                      <p className="text-xs text-muted-foreground">{when}</p>
                    ) : null}
                  </div>
                </div>

                {row.status === "failed" ? (
                  <Badge variant="destructive">{t("statusFailed")}</Badge>
                ) : row.total_awarded === null ? (
                  <span className="text-sm text-muted-foreground">{t("noMarkYet")}</span>
                ) : (
                  <div className="text-right">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {t("tableScore")}
                    </p>
                    <p className="font-heading text-lg font-semibold tabular-nums">
                      {row.total_awarded}
                      <span className="text-sm font-normal text-muted-foreground">
                        /{row.total_max}
                      </span>
                    </p>
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
