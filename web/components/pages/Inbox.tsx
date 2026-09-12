"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ApiError, apiGet, type SubmissionSummary } from "@/lib/api";
import { STATUS_KEY, formatDate, usePrefs } from "@/lib/i18n";

export default function InboxPage() {
  const { t } = usePrefs();
  const [rows, setRows] = useState<SubmissionSummary[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiGet<SubmissionSummary[]>("/api/submissions")
      .then(setRows)
      .catch((e) => setError(e instanceof ApiError ? e.message : t("loadFailed")));
  }, []);

  if (error) return <div className="banner err">{error}</div>;
  if (!rows)
    return (
      <div className="center">
        <span className="spin" />
      </div>
    );

  return (
    <>
      <h1>{t("navMine")}</h1>
      {rows.length === 0 ? (
        <p className="lede">
          {t("inboxEmpty")} <Link href="/">{t("submitFirst")}</Link>
        </p>
      ) : (
        <div className="list">
          {rows.map((row) => {
            const title = row.subject || row.question_text.trim().split("\n")[0] || t("untitled");
            const when = formatDate(row.created_at);
            return (
              <Link key={row.id} href={`/s/${row.id}`} className="item">
                <span className="q">
                  <span className="q-title">{title.slice(0, 80)}</span>
                  <span className="q-meta">
                    {when}
                    {when && " · "}
                    {t(STATUS_KEY[row.status])}
                  </span>
                </span>
                {row.needs_human_review && <span className="pill flag">{t("navReview")}</span>}
                {row.status === "failed" ? (
                  <span className="pill bad">{t("statusFailed")}</span>
                ) : row.total_awarded === null ? (
                  <span className="muted" style={{ fontSize: 13 }}>{t("noMarkYet")}</span>
                ) : (
                  <span className="score-chip">
                    <strong>{row.total_awarded}</strong>
                    <span className="muted">/{row.total_max}</span>
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
