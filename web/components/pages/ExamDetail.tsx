"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import { usePrefs } from "@/lib/i18n";

type Question = {
  id: string;
  prompt_text: string;
  approved: boolean;
  source: string;
  total_marks: number;
  rubric_json: unknown;
};

type BatchOption = { id: string; name: string };

type ExamDetail = {
  id: string;
  title: string;
  exam_code: string | null;
  status: string;
  publish_mode: string | null;
  questions: Question[];
  batch: { id: string; name: string } | null;
};

export default function ExamDetailPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : params.id?.[0];
  const { t } = usePrefs();
  const [exam, setExam] = useState<ExamDetail | null>(null);
  const [batches, setBatches] = useState<BatchOption[]>([]);
  const [batchId, setBatchId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    if (!id) return;
    try {
      const [examRes, batchRes] = await Promise.all([
        apiGet<{ exam: ExamDetail }>(`/api/teacher/exams/${id}`),
        apiGet<{ batches: BatchOption[] }>("/api/teacher/batches"),
      ]);
      setExam(examRes.exam);
      setBatches(batchRes.batches.map((b) => ({ id: b.id, name: b.name })));
      setBatchId(examRes.exam.batch?.id || "");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("loadFailed"));
    }
  }

  useEffect(() => {
    void load();
  }, [id]);

  async function approve(questionId: string) {
    if (!id) return;
    setBusy(true);
    try {
      await apiPost(`/api/teacher/exams/${id}/questions/${questionId}/approve`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function publish(event: FormEvent) {
    event.preventDefault();
    if (!id || !batchId) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await apiPost<{ exam: ExamDetail }>(`/api/teacher/exams/${id}/publish`, {
        batch_id: batchId,
      });
      setExam(data.exam);
      setNotice(`${t("published")}: ${data.exam.exam_code}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function closeExam() {
    if (!id) return;
    setBusy(true);
    try {
      const data = await apiPost<{ exam: ExamDetail }>(`/api/teacher/exams/${id}/close`);
      setExam((prev) => (prev ? { ...prev, ...data.exam } : data.exam));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (!exam) {
    return (
      <div className="stack">
        <Link href="/exams">{t("back")}</Link>
        {error ? <p className="error">{error}</p> : <span className="spin" />}
      </div>
    );
  }

  return (
    <div className="stack">
      <Link href="/exams">{t("back")}</Link>
      <div>
        <h1>{exam.title}</h1>
        <p className="muted">
          {exam.exam_code || "—"} · {exam.status}
          {exam.batch ? ` · ${exam.batch.name}` : ""}
        </p>
      </div>

      {error && <p className="error">{error}</p>}
      {notice && <p className="muted">{notice}</p>}

      <section className="card stack">
        <h2>{t("addQuestion")}</h2>
        {exam.questions.map((q) => (
          <div key={q.id} className="stack" style={{ gap: 6 }}>
            <div className="row">
              <span className={`pill ${q.approved ? "done" : ""}`}>
                {q.approved ? t("approved") : t("pendingApproval")}
              </span>
              <span className="muted">{q.source}</span>
              <span className="spacer" />
              {!q.approved && (
                <button
                  className="ghost small"
                  disabled={busy}
                  type="button"
                  onClick={() => void approve(q.id)}
                >
                  {t("approve")}
                </button>
              )}
            </div>
            <p style={{ whiteSpace: "pre-wrap" }}>{q.prompt_text || "—"}</p>
          </div>
        ))}
      </section>

      {exam.status !== "closed" && (
        <form className="card stack" onSubmit={publish}>
          <h2>{t("publishExam")}</h2>
          <label>
            {t("assignBatch")}
            <select
              value={batchId}
              onChange={(e) => setBatchId(e.target.value)}
              required
            >
              <option value="">—</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <div className="row" style={{ gap: 8 }}>
            <button className="primary" disabled={busy || !batchId} type="submit">
              {t("publishExam")}
            </button>
            {exam.status === "published" && (
              <button
                className="ghost"
                type="button"
                disabled={busy}
                onClick={() => void closeExam()}
              >
                {t("closeExam")}
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
