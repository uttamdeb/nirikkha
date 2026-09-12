"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  apiDelete,
  apiGet,
  apiPost,
  type Annotation,
  type Mark,
  type PartKey,
  type Submission,
  personName,
} from "@/lib/api";
import Annotator from "@/components/Annotator";
import ScriptText from "@/components/ScriptText";
import { SKILL_KEY, statusKey, usePrefs, type StringKey } from "@/lib/i18n";

/** Each refusal cause gets its own next step — a student who photographed the
    wrong thing needs different advice from one whose photo was out of focus. */
const FIX_FOR: Record<string, StringKey> = {
  not_a_script: "fixNotAScript",
  rotated: "fixRotated",
  too_blurry: "fixTooBlurry",
  blank: "fixBlank",
};

export default function ResultPage({ id, isTeacher }: { id: string; isTeacher: boolean }) {
  const { t } = usePrefs();
  const [sub, setSub] = useState<Submission | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [lineEdit, setLineEdit] = useState<Record<number, string>>({});
  const [note, setNote] = useState<string | null>(null);
  const [noteSaved, setNoteSaved] = useState(false);
  const [regrading, setRegrading] = useState(false);
  const [editingFeedback, setEditingFeedback] = useState(false);
  const [feedbackDraft, setFeedbackDraft] = useState("");

  const load = useCallback(
    async (withImage = true) => {
      try {
        const next = await apiGet<Submission>(
          `/api/submissions/${id}${withImage ? "" : "?image=false"}`,
        );
        // A signed URL lasts an hour, so polling asks the server to skip minting
        // a fresh one and we carry the one we already have.
        setSub((prev) =>
          next.image_urls?.length
            ? next
            : { ...next, image_url: prev?.image_url ?? null, image_urls: prev?.image_urls ?? [] },
        );
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t("loadFailed"));
      }
    },
    [id, t],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // While a stage is mid-flight the row changes underneath us; poll until it settles.
  useEffect(() => {
    if (!sub || !["ocr_running", "grading", "received"].includes(sub.status)) return;
    const timer = setTimeout(() => void load(false), 2500);
    return () => clearTimeout(timer);
  }, [sub, load]);

  async function clarify(lineIndex: number) {
    const text = (draft[lineIndex] ?? "").trim();
    if (!text) return;
    setBusy(true);
    setError("");
    try {
      await apiPost(`/api/submissions/${id}/clarify`, { line_index: lineIndex, text });
      setDraft((d) => {
        const next = { ...d };
        delete next[lineIndex];
        return next;
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function saveFeedback() {
    setBusy(true);
    setError("");
    try {
      await apiPost(`/api/submissions/${id}/edit-feedback`, { text: feedbackDraft });
      setEditingFeedback(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function rewriteMark(part: PartKey, reason: string, improvement: string) {
    setError("");
    try {
      await apiPost(`/api/submissions/${id}/override`, { part, reason, improvement });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("saveFailed"));
    }
  }

  async function override(part: PartKey, value: number) {
    setBusy(true);
    setError("");
    try {
      await apiPost(`/api/submissions/${id}/override`, { part, new_awarded: value });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("markChangeFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function editLine(index: number) {
    const text = (lineEdit[index] ?? "").trim();
    if (!text) return;
    setBusy(true);
    setError("");
    try {
      await apiPost(`/api/submissions/${id}/edit-line`, { line_index: index, text });
      setLineEdit((d) => {
        const next = { ...d };
        delete next[index];
        return next;
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function regrade() {
    setRegrading(true);
    setError("");
    try {
      await apiPost(`/api/submissions/${id}/regrade`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("genericError"));
    } finally {
      setRegrading(false);
    }
  }

  async function saveNote() {
    setBusy(true);
    setError("");
    try {
      await apiPost(`/api/submissions/${id}/feedback`, { text: note ?? "" });
      setNoteSaved(true);
      setTimeout(() => setNoteSaved(false), 2000);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function addAnnotation(a: Omit<Annotation, "id">) {
    await apiPost(`/api/submissions/${id}/annotations`, a);
    await load();
  }

  async function removeAnnotation(annotationId: string) {
    await apiDelete(`/api/submissions/${id}/annotations/${annotationId}`);
    await load();
  }

  async function release() {
    setBusy(true);
    setError("");
    try {
      await apiPost(`/api/submissions/${id}/release`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("releaseFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (!sub) {
    return error ? (
      <div className="banner err">{error}</div>
    ) : (
      <div className="center">
        <span className="spin" />
      </div>
    );
  }

  const pending = sub.lines.filter((l) => l.needs_clarification);
  const working = ["received", "ocr_running", "grading"].includes(sub.status);

  return (
    <>
      <div className="row" style={{ marginBottom: 6 }}>
        <Link href="/inbox" className="muted" style={{ textDecoration: "none" }}>
          {t("back")}
        </Link>
        <div className="spacer" />
        <span className={`pill ${sub.status === "released" ? "done" : sub.status === "failed" ? "bad" : ""}`}>
          {t(statusKey(sub.status, isTeacher))}
        </span>
      </div>

      <h1>{sub.subject || t("scriptWord")}</h1>
      {error && <div className="banner err">{error}</div>}

      {sub.status === "failed" && (
        <div className="banner err">
          <strong>{sub.error || t("unreadable")}</strong>
          {sub.review_reason && FIX_FOR[sub.review_reason] && (
            <p style={{ margin: "10px 0 0" }}>
              <strong>{t("whatToDo")}: </strong>
              {t(FIX_FOR[sub.review_reason])}
            </p>
          )}
          <p style={{ margin: "12px 0 0" }}>
            <Link href="/">{t("submitTitle")}</Link>
          </p>
        </div>
      )}

      {sub.marks_stale && isTeacher && (
        <div className="banner warn">
          <strong>{t("staleWarning")}</strong>
          <div style={{ marginTop: 9 }}>
            <button className="small" disabled={regrading} onClick={() => void regrade()}>
              {regrading ? <span className="spin" /> : t("regrade")}
            </button>
          </div>
        </div>
      )}

      {working && (
        <div className="banner">
          <span className="spin" /> {t("working")}
        </div>
      )}

      {/* The clarification loop — the part that makes this more than a grader. */}
      {pending.length > 0 && (
        <div className="card" style={{ borderColor: "var(--amber)" }}>
          <h2 style={{ color: "var(--amber)" }}>{t("cannotRead", { n: pending.length })}</h2>
<p className="muted" style={{ marginBottom: 18 }}>{t("cannotReadLede")}</p>
          {pending.map((line) => (
            <div key={line.index} className="field">
              <label htmlFor={`fix-${line.index}`}>
                {t("lineN", { n: line.index + 1 })}
                {line.legibility !== null && (
                  <span className="muted" style={{ marginInlineStart: 8 }}>
                    {t("legibilityLabel", { n: line.legibility.toFixed(2) })}
                  </span>
                )}
              </label>
              <p style={{ marginBottom: 8 }}>
                <ScriptText text={line.text} />
              </p>
              <div className="row" style={{ flexWrap: "nowrap" }}>
                <input
                  id={`fix-${line.index}`}
                  type="text"
                  value={draft[line.index] ?? ""}
                  onChange={(e) => setDraft({ ...draft, [line.index]: e.target.value })}
                  placeholder={t("whatDoesItSay")}
                  maxLength={2000}
                />
                <button
                  className="small"
                  disabled={busy || !(draft[line.index] ?? "").trim()}
                  onClick={() => void clarify(line.index)}
                >
                  {t("fixIt")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {sub.marks.length > 0 && (
        <>
          <div
            className={`total ${
              sub.total_awarded === null
                ? ""
                : sub.total_awarded / sub.total_max >= 0.7
                  ? "good"
                  : sub.total_awarded / sub.total_max >= 0.4
                    ? "mid"
                    : "low"
            }`}
          >
            <span className="num">{sub.total_awarded ?? "—"}</span>
            <span className="muted">/ {sub.total_max}</span>
            <div className="spacer" />
            {sub.needs_human_review && <span className="pill flag">{t("reviewNeeded")}</span>}
          </div>

          <div className="marks">
            {sub.marks.map((mark) => (
              <MarkRow
                key={mark.part}
                mark={mark}
                editable={isTeacher && sub.status !== "released"}
                busy={busy}
                onChange={(v) => void override(mark.part, v)}
                onRewrite={(reason, improvement) =>
                  rewriteMark(mark.part, reason, improvement)
                }
              />
            ))}
          </div>

          {sub.feedback && (
            <div className="card" style={{ marginTop: 18 }}>
              <div className="row" style={{ marginBottom: 8 }}>
                <h3 style={{ margin: 0 }}>{t("agentFeedback")}</h3>
                <span className="pill">
                  {sub.feedback_edited_by
                    ? t("editedBy", { who: personName(sub.feedback_edited_by) })
                    : t("byAgent")}
                </span>
                <div className="spacer" />
                {isTeacher && sub.status !== "released" && !editingFeedback && (
                  <button
                    className="ghost small"
                    onClick={() => {
                      setFeedbackDraft(sub.feedback ?? "");
                      setEditingFeedback(true);
                    }}
                  >
                    {t("editFeedback")}
                  </button>
                )}
              </div>

              {editingFeedback ? (
                <>
                  <textarea
                    value={feedbackDraft}
                    onChange={(e) => setFeedbackDraft(e.target.value)}
                    maxLength={4000}
                    style={{ minHeight: 96 }}
                  />
                  <div className="row" style={{ marginTop: 9 }}>
                    <button className="small" disabled={busy} onClick={() => void saveFeedback()}>
                      {t("saveLine")}
                    </button>
                    <button className="ghost small" onClick={() => setEditingFeedback(false)}>
                      {t("cancel")}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p style={{ marginBottom: 0 }}>
                    <ScriptText text={sub.feedback} />
                  </p>
                  {sub.ai_feedback && sub.ai_feedback !== sub.feedback && (
                    <details className="agent-wording">
                      <summary>{t("showAgentWording")}</summary>
                      <ScriptText text={sub.ai_feedback} />
                    </details>
                  )}
                </>
              )}
            </div>
          )}

          {isTeacher ? (
            <div className="card">
              <h3>{t("teacherFeedbackLabel")}</h3>
              <p className="muted" style={{ margin: "0 0 8px" }}>{t("teacherFeedbackHint")}</p>
              <textarea
                value={note ?? sub.teacher_feedback ?? ""}
                onChange={(e) => setNote(e.target.value)}
                maxLength={2000}
                style={{ minHeight: 86 }}
              />
              <div className="row" style={{ marginTop: 9 }}>
                <button className="small" disabled={busy} onClick={() => void saveNote()}>
                  {t("saveFeedback")}
                </button>
                {noteSaved && <span className="muted">{t("saved")}</span>}
              </div>
            </div>
          ) : (
            sub.teacher_feedback && (
              <div className="card">
                <div className="row" style={{ marginBottom: 8 }}>
                  <h3 style={{ margin: 0 }}>{t("teacherFeedbackLabel")}</h3>
                  {sub.reviewed_by && (
                    <span className="pill">
                      {t("writtenBy", { who: personName(sub.reviewed_by) })}
                    </span>
                  )}
                </div>
                <p style={{ marginBottom: 0 }}>
                  <ScriptText text={sub.teacher_feedback} />
                </p>
              </div>
            )
          )}

          {isTeacher && sub.status === "awaiting_teacher" && (
            <div className="row" style={{ marginTop: 18 }}>
              <button onClick={() => void release()} disabled={busy || sub.marks_stale}>
                {t("releaseResult")}
              </button>
              <span className="muted">{t("releaseHint")}</span>
            </div>
          )}
        </>
      )}

      <details className="card" style={{ marginTop: 18 }} open={isTeacher}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>
          {t("transcript", { n: sub.lines.length })}
        </summary>
        {isTeacher && (
          <p className="muted" style={{ margin: "10px 0 0" }}>{t("editTranscriptHint")}</p>
        )}
        <div className="script" style={{ marginTop: 14 }}>
          {sub.lines.map((line) => {
            const shown = line.clarified_text ?? line.text;
            const editing = lineEdit[line.index] !== undefined;
            return (
              <div
                key={line.index}
                className={`line ${line.clarified_text ? "fixed" : line.needs_clarification ? "flagged" : ""}`}
              >
                <span className="n">{line.index + 1}</span>
                <span className="body">
                  {editing ? (
                    <span className="row" style={{ flexWrap: "nowrap" }}>
                      <input
                        type="text"
                        value={lineEdit[line.index]}
                        autoFocus
                        maxLength={2000}
                        onChange={(e) =>
                          setLineEdit({ ...lineEdit, [line.index]: e.target.value })
                        }
                        onKeyDown={(e) => e.key === "Enter" && void editLine(line.index)}
                      />
                      <button
                        className="small"
                        disabled={busy}
                        onClick={() => void editLine(line.index)}
                      >
                        {t("saveLine")}
                      </button>
                      <button
                        className="ghost small"
                        onClick={() =>
                          setLineEdit((d) => {
                            const next = { ...d };
                            delete next[line.index];
                            return next;
                          })
                        }
                      >
                        {t("cancel")}
                      </button>
                    </span>
                  ) : (
                    <>
                      <ScriptText text={shown} />
                      {line.clarified_text && (
                        <span className="was">
                          {t("readAsBefore")}
                          <ScriptText text={line.text} />
                        </span>
                      )}
                    </>
                  )}
                </span>
                {isTeacher && !editing && (
                  <button
                    className="ghost small line-edit"
                    onClick={() => setLineEdit({ ...lineEdit, [line.index]: shown })}
                  >
                    ✎
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </details>

      {(sub.image_urls?.length ?? 0) > 0 && (
        <details className="card" open={isTeacher}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>
            {t("originalImage")}
            {sub.image_urls.length > 1 && (
              <span className="muted"> · {t("pagesLabel", { n: sub.image_urls.length })}</span>
            )}
            {sub.annotations.length > 0 && (
              <span className="muted"> · {t("annotationsN", { n: sub.annotations.length })}</span>
            )}
          </summary>
          {isTeacher && (
            <p className="muted" style={{ margin: "10px 0 0" }}>{t("annotateHint")}</p>
          )}
          <div style={{ display: "grid", gap: 16, marginTop: 14 }}>
            {sub.image_urls.map((url, i) => (
              <Annotator
                key={url}
                url={url}
                page={i}
                annotations={sub.annotations}
                editable={isTeacher && sub.status !== "released"}
                onAdd={addAnnotation}
                onDelete={removeAnnotation}
              />
            ))}
          </div>
        </details>
      )}

      <p className="muted mono" style={{ marginTop: 24 }}>
        {sub.ocr_engine && `ocr: ${sub.ocr_engine}`}
        {sub.grader_model && ` · grader: ${sub.grader_model}`}
      </p>
    </>
  );
}

function MarkRow({
  mark,
  editable,
  busy,
  onChange,
  onRewrite,
}: {
  mark: Mark;
  editable: boolean;
  busy: boolean;
  onChange: (value: number) => void;
  onRewrite: (reason: string, improvement: string) => Promise<void>;
}) {
  const { t } = usePrefs();
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState(mark.reason);
  const [improvement, setImprovement] = useState(mark.improvement);
  const [saving, setSaving] = useState(false);

  const rewritten =
    (mark.ai_reason && mark.ai_reason !== mark.reason) ||
    (mark.ai_improvement && mark.ai_improvement !== mark.improvement);

  async function save() {
    setSaving(true);
    try {
      await onRewrite(reason, improvement);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="mark">
        <span className="label">
          <span className="bn">{mark.bangla}</span>
          <span className="skill">{t(SKILL_KEY[mark.part] as StringKey)}</span>
        </span>
        <span className="why">
          <label htmlFor={`r-${mark.part}`}>{t("reasonLabel")}</label>
          <textarea
            id={`r-${mark.part}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={2000}
            style={{ minHeight: 74 }}
          />
          <label htmlFor={`i-${mark.part}`} style={{ marginTop: 9 }}>
            {t("improvementLabel")}
          </label>
          <textarea
            id={`i-${mark.part}`}
            value={improvement}
            onChange={(e) => setImprovement(e.target.value)}
            maxLength={2000}
            style={{ minHeight: 58 }}
          />
          <span className="row" style={{ marginTop: 9 }}>
            <button className="small" disabled={saving} onClick={() => void save()}>
              {saving ? <span className="spin" /> : t("saveLine")}
            </button>
            <button
              className="ghost small"
              onClick={() => {
                setReason(mark.reason);
                setImprovement(mark.improvement);
                setEditing(false);
              }}
            >
              {t("cancel")}
            </button>
          </span>
        </span>
      </div>
    );
  }

  return (
    <div className="mark">
      <span className="label">
        <span className="bn">{mark.bangla}</span>
        <span className="skill">{t(SKILL_KEY[mark.part] as StringKey)}</span>
      </span>
      <span className="score">
        {editable ? (
          <select
            value={mark.awarded}
            disabled={busy}
            aria-label={`${mark.bangla}`}
            onChange={(e) => onChange(Number(e.target.value))}
            style={{ width: 64, padding: "4px 6px" }}
          >
            {Array.from({ length: mark.max_marks + 1 }, (_, i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        ) : (
          mark.awarded
        )}
        <span className="muted"> / {mark.max_marks}</span>
      </span>
      <span className="why">
        {mark.ai_awarded !== null && mark.ai_awarded !== mark.awarded && (
          <span className="pill flag" style={{ marginInlineEnd: 7 }}>
            {t("overriddenBadge")} · {t("aiProposed", { n: mark.ai_awarded })}
          </span>
        )}
        {rewritten && (
          <span className="pill" style={{ marginInlineEnd: 7 }}>
            {mark.edited_by
              ? t("editedBy", { who: personName(mark.edited_by) })
              : t("rewritten")}
          </span>
        )}
        <ScriptText text={mark.reason} />
        {mark.improvement && (
          <span className="improve">
            <strong>{t("howToFullMarks")}</strong>
            <ScriptText text={mark.improvement} />
          </span>
        )}
        {mark.evidence_lines.length > 0 && (
          <span className="ev">
            {t("evidenceLines", { lines: mark.evidence_lines.map((n) => n + 1).join(", ") })}
          </span>
        )}
        {rewritten && (
          <details className="agent-wording">
            <summary>{t("showAgentWording")}</summary>
            <ScriptText text={mark.ai_reason} />
            {mark.ai_improvement && (
              <span style={{ display: "block", marginTop: 5 }}>
                <ScriptText text={mark.ai_improvement} />
              </span>
            )}
          </details>
        )}
        {editable && (
          <button className="ghost small" style={{ marginTop: 8 }} onClick={() => setEditing(true)}>
            {t("editReason")}
          </button>
        )}
      </span>
    </div>
  );
}
