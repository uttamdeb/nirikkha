"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ApiError, apiGet, type SubmissionSummary } from "@/lib/api";
import { usePrefs } from "@/lib/i18n";

export default function ReviewPage() {
  const { t } = usePrefs();
  const [rows, setRows] = useState<SubmissionSummary[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiGet<SubmissionSummary[]>("/api/review-queue")
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

  const flagged = rows.filter((r) => r.needs_human_review);

  return (
    <>
      <h1>{t("reviewTitle")}</h1>
      <p className="lede">{t("reviewLede")}</p>

      {rows.length === 0 ? (
        <p className="muted">{t("queueEmpty")}</p>
      ) : (
        <>
          {flagged.length > 0 && (
<div className="banner warn">{t("unsureCount", { n: flagged.length })}</div>
          )}
          <div className="list">
            {rows.map((row) => (
              <Link key={row.id} href={`/s/${row.id}`} className="item">
                <span className="q">{row.subject || row.question_text.slice(0, 70)}</span>
                {row.needs_human_review && (
                  <span className="pill flag">
                    {row.review_reason === "grader_uncertain" ? t("agentUnsure") : t("unclearWriting")}
                  </span>
                )}
                <span className="mono" style={{ minWidth: 52, textAlign: "right" }}>
                  {row.total_awarded ?? "—"}/{row.total_max}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
    </>
  );
}
