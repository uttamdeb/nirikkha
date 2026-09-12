"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ApiError,
  apiGet,
  apiPost,
  type PanelPage,
  type PanelRow,
  type TeacherStats,
} from "@/lib/api";
import { formatDate, statusKey, usePrefs } from "@/lib/i18n";

const STATUSES = [
  "all",
  "awaiting_teacher",
  "awaiting_student",
  "released",
  "failed",
  "received",
] as const;

export default function PanelPageView() {
  const { t } = usePrefs();
  const [page, setPage] = useState<PanelPage | null>(null);
  const [stats, setStats] = useState<TeacherStats | null>(null);
  const [status, setStatus] = useState<string>("all");
  const [flagged, setFlagged] = useState(false);
  const [query, setQuery] = useState("");
  const [examId, setExamId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [exams, setExams] = useState<{ id: string; title: string }[]>([]);
  const [batches, setBatches] = useState<{ id: string; name: string }[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<PanelRow[]>([]);
  const [offset, setOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const PAGE = 50;

  const fetchPage = useCallback(
    async (from: number) => {
      const params = new URLSearchParams({ limit: String(PAGE), offset: String(from) });
      if (status !== "all") params.set("status", status);
      if (flagged) params.set("flagged", "true");
      if (query.trim()) params.set("q", query.trim());
      if (examId) params.set("exam_id", examId);
      if (batchId) params.set("batch_id", batchId);
      return apiGet<PanelPage>(`/api/teacher/panel?${params}`);
    },
    [status, flagged, query, examId, batchId],
  );

  const load = useCallback(async () => {
    try {
      const first = await fetchPage(0);
      setPage(first);
      setRows(first.rows);
      setOffset(0);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("loadFailed"));
    }
  }, [fetchPage, t]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const next = await fetchPage(offset + PAGE);
      setPage(next);
      // Append rather than replace, so scrolling through a long queue does not
      // lose what is already on screen.
      setRows((prev) => [...prev, ...next.rows]);
      setOffset(offset + PAGE);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("loadFailed"));
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    // Debounced so typing in the search box does not fire a request per keystroke.
    const timer = setTimeout(() => void load(), query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  useEffect(() => {
    apiGet<TeacherStats>("/api/teacher/stats").then(setStats).catch(() => setStats(null));
    apiGet<{ exams: { id: string; title: string }[] }>("/api/teacher/exams")
      .then((d) => setExams(d.exams))
      .catch(() => setExams([]));
    apiGet<{ batches: { id: string; name: string }[] }>("/api/teacher/batches")
      .then((d) => setBatches(d.batches))
      .catch(() => setBatches([]));
  }, []);

  // Only a marked, non-stale script can be released, so anything else is not
  // offered for selection — better than letting a teacher pick thirty and
  // discover afterwards that eleven were skipped.
  const releasable = useMemo(
    () => rows.filter((r) => r.status === "awaiting_teacher" && !r.marks_stale),
    [rows],
  );

  async function releaseSelected() {
    if (picked.size === 0) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await apiPost<{ released_count: number; skipped_count: number }>(
        "/api/teacher/release",
        { submission_ids: [...picked] },
      );
      setNotice(
        `${t("releasedN", { n: res.released_count })}` +
          (res.skipped_count ? ` · ${t("skippedN", { n: res.skipped_count })}` : ""),
      );
      setPicked(new Set());
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("genericError"));
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <>
      <h1>{t("panelTitle")}</h1>
      <p className="lede">{t("panelLede")}</p>

      {error && <div className="banner err">{error}</div>}
      {notice && <div className="banner ok">{notice}</div>}

      {stats && stats.scored > 0 && (
        <div className="card">
          <h2>{t("statsTitle")}</h2>
          <div className="stat-row">
            <div className="stat">
              <span className="k">{t("statAverage")}</span>
              <span className="v">
                {stats.average}
                <small>/10</small>
              </span>
            </div>
            <div className="stat">
              <span className="k">{t("statHighest")}</span>
              <span className="v ok">
                {stats.highest}
                <small>/10</small>
              </span>
            </div>
            <div className="stat">
              <span className="k">{t("statOverride")}</span>
              <span className="v warn">{Math.round((stats.override_rate ?? 0) * 100)}%</span>
            </div>
          </div>

          <h3 style={{ marginTop: 18 }}>{t("weaknesses")}</h3>
          {Object.entries(stats.per_part)
            .sort((a, b) => (a[1].accuracy ?? 1) - (b[1].accuracy ?? 1))
            .map(([key, part]) => (
              <div key={key} className="bar-row">
                <span className="bar-label">
                  <strong>{part.bangla}</strong> {part.skill}
                </span>
                <span className="bar-track">
                  <span
                    className="bar-fill"
                    style={{
                      width: `${Math.round((part.accuracy ?? 0) * 100)}%`,
                      background:
                        (part.accuracy ?? 0) < 0.7 ? "var(--amber)" : "var(--green)",
                    }}
                  />
                </span>
                <span className="bar-value">
                  {t("classAccuracy", { p: Math.round((part.accuracy ?? 0) * 100) })}
                </span>
              </div>
            ))}
        </div>
      )}

      <div className="filters">
        {STATUSES.map((s) => (
          <button
            key={s}
            className={`chip ${status === s && !flagged ? "on" : ""}`}
            onClick={() => {
              setStatus(s);
              setFlagged(false);
            }}
          >
            {s === "all" ? t("filterAll") : t(statusKey(s, true))}
            {page?.counts?.[s] !== undefined && <span className="n">{page.counts[s]}</span>}
            {s === "all" && page && <span className="n">{page.total}</span>}
          </button>
        ))}
        <button
          className={`chip ${flagged ? "on flag" : ""}`}
          onClick={() => {
            setFlagged((v) => !v);
            setStatus("all");
          }}
        >
          {t("filterFlagged")}
          {page && <span className="n">{page.flagged}</span>}
        </button>
        <input
          type="text"
          className="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchPlaceholder")}
        />
        <select
          className="search"
          value={examId}
          onChange={(e) => setExamId(e.target.value)}
          aria-label={t("examsTitle")}
        >
          <option value="">{t("examsTitle")}: —</option>
          {exams.map((exam) => (
            <option key={exam.id} value={exam.id}>
              {exam.title}
            </option>
          ))}
        </select>
        <select
          className="search"
          value={batchId}
          onChange={(e) => setBatchId(e.target.value)}
          aria-label={t("batchesTitle")}
        >
          <option value="">{t("batchesTitle")}: —</option>
          {batches.map((batch) => (
            <option key={batch.id} value={batch.id}>
              {batch.name}
            </option>
          ))}
        </select>
      </div>

      {picked.size > 0 && (
        <div className="bulk-bar">
          <span>{t("selected", { n: picked.size })}</span>
          <div className="spacer" />
          <button className="ghost small" onClick={() => setPicked(new Set())}>
            {t("clearSelection")}
          </button>
          <button className="small" disabled={busy} onClick={() => void releaseSelected()}>
            {busy ? <span className="spin" /> : t("releaseSelected")}
          </button>
        </div>
      )}

      {!page ? (
        <div className="center">
          <span className="spin" />
        </div>
      ) : rows.length === 0 ? (
        <p className="muted">{t("noResults")}</p>
      ) : (
        <div className="list">
          {rows.map((row) => {
            const canRelease = releasable.some((r) => r.id === row.id);
            return (
              <div key={row.id} className="item panel-row">
                <input
                  type="checkbox"
                  checked={picked.has(row.id)}
                  disabled={!canRelease}
                  onChange={() => toggle(row.id)}
                  title={canRelease ? "" : t("statusAwaitingTeacher")}
                  aria-label={row.student?.email ?? row.id}
                />
                <Link href={`/s/${row.id}`} className="q">
                  <span className="q-title">
                    {row.student?.full_name || row.student?.email || "—"}
                  </span>
                  <span className="q-meta">
                    {row.subject || row.question_text.trim().split("\n")[0]?.slice(0, 46) ||
                      t("untitled")}
                    {row.pages > 1 && ` · ${t("pagesLabel", { n: row.pages })}`}
                    {row.created_at && ` · ${formatDate(row.created_at)}`}
                  </span>
                </Link>
                {row.marks_stale && <span className="pill bad">{t("regrade")}</span>}
                {row.needs_human_review && <span className="pill flag">{t("filterFlagged")}</span>}
                <span
                  className={`pill ${
                    row.status === "released" ? "done" : row.status === "failed" ? "bad" : ""
                  }`}
                >
                  {t(statusKey(row.status, true))}
                </span>
                <span className="score-chip">
                  {row.total_awarded === null ? (
                    <span className="muted">—</span>
                  ) : (
                    <>
                      <strong>{row.total_awarded}</strong>
                      <span className="muted">/{row.total_max}</span>
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {page && rows.length > 0 && (
        <div className="row" style={{ marginTop: 16, alignItems: "center" }}>
          <span className="muted">
            {t("showingN", { shown: rows.length, total: page.matched || page.total })}
          </span>
          <div className="spacer" />
          {rows.length < (page.matched || page.total) && (
            <button className="ghost small" disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore ? <span className="spin" /> : t("loadMore")}
            </button>
          )}
        </div>
      )}
    </>
  );
}
