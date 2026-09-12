import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, apiPost, API_BASE, supabase } from "../lib/api";
import { usePrefs } from "../lib/i18n";

type RubricPart = {
  key: "ka" | "kha" | "ga" | "gha";
  label: string;
  title: string;
  prompt: string;
  modelAnswer: string;
  maxMarks: number;
};

const DEFAULT_RUBRIC: RubricPart[] = [
  { key: "ka", label: "ক", title: "জ্ঞান", prompt: "", modelAnswer: "", maxMarks: 1 },
  { key: "kha", label: "খ", title: "অনুধাবন", prompt: "", modelAnswer: "", maxMarks: 2 },
  { key: "ga", label: "গ", title: "প্রয়োগ", prompt: "", modelAnswer: "", maxMarks: 3 },
  { key: "gha", label: "ঘ", title: "উচ্চতর দক্ষতা", prompt: "", modelAnswer: "", maxMarks: 4 },
];

function sumRubricMarks(parts: RubricPart[]): number {
  return parts.reduce((sum, part) => sum + (Number(part.maxMarks) || 0), 0);
}

function isValidRubric(parts: RubricPart[], totalMarks: number): boolean {
  if (parts.length !== 4) return false;
  const keys = new Set(parts.map((p) => p.key));
  if (keys.size !== 4) return false;
  return sumRubricMarks(parts) === totalMarks;
}

export default function ExamNewPage() {
  const { t } = usePrefs();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"manual" | "generate">("manual");
  const [title, setTitle] = useState("");
  const [publishMode, setPublishMode] = useState<"admin" | "auto" | "inherit">("inherit");
  const [promptText, setPromptText] = useState("");
  const [totalMarks, setTotalMarks] = useState("10");
  const [rubric, setRubric] = useState<RubricPart[]>(
    DEFAULT_RUBRIC.map((part) => ({ ...part })),
  );
  const [sourceText, setSourceText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const marksTotal = Number(totalMarks) || 10;
  const rubricSum = useMemo(() => sumRubricMarks(rubric), [rubric]);
  const rubricOk = isValidRubric(rubric, marksTotal);

  function updatePart(index: number, patch: Partial<RubricPart>) {
    setRubric((prev) =>
      prev.map((part, i) => (i === index ? { ...part, ...patch } : part)),
    );
  }

  async function handleCreate(createMode: "manual" | "generate") {
    if (!title.trim()) return;
    setBusy(true);
    setError("");

    if (createMode === "manual" && !rubricOk) {
      setBusy(false);
      setError(t("rubricSumError", { sum: rubricSum, total: marksTotal }));
      return;
    }

    if (createMode === "manual" && !promptText.trim()) {
      setBusy(false);
      setError(t("stemRequired"));
      return;
    }

    try {
      const created = await apiPost<{ exam: { id: string } }>("/api/teacher/exams", {
        title: title.trim(),
        publish_mode: publishMode === "inherit" ? null : publishMode,
      });
      const examId = created.exam.id;

      if (createMode === "manual") {
        await apiPost(`/api/teacher/exams/${examId}/questions`, {
          prompt_text: promptText.trim(),
          total_marks: marksTotal,
          rubric_json: rubric,
          approved: true,
        });
      } else {
        const form = new FormData();
        if (sourceText.trim()) form.append("source_text", sourceText.trim());
        if (file) form.append("file", file);
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        const response = await fetch(`${API_BASE}/api/teacher/exams/${examId}/generate`, {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: form,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new ApiError(
            typeof body.detail === "string" ? body.detail : "Generate failed",
            response.status,
          );
        }
      }

      navigate(`/exams/${examId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <Link to="/exams" className="muted">
          {t("examsTitle")}
        </Link>
        <span className="muted">/</span>
        <span className="muted">{t("createExam")}</span>
      </div>

      <div>
        <h1>{t("createExam")}</h1>
        <p className="lede">{t("createExamLede")}</p>
      </div>

      {error && <p className="error">{error}</p>}

      <section className="card">
        <h2 style={{ marginTop: 0 }}>{t("examDetails")}</h2>
        <div className="exam-details-grid">
          <label className="field">
            {t("examTitle")}
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("examTitlePlaceholder")}
              required
            />
          </label>
          <label className="field">
            {t("publishModeExam")}
            <select
              value={publishMode}
              onChange={(e) =>
                setPublishMode(e.target.value as "admin" | "auto" | "inherit")
              }
            >
              <option value="inherit">{t("publishInherit")}</option>
              <option value="admin">{t("publishAdmin")}</option>
              <option value="auto">{t("publishAuto")}</option>
            </select>
          </label>
        </div>
      </section>

      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className={mode === "manual" ? "primary small" : "ghost small"}
          onClick={() => setMode("manual")}
        >
          {t("manualCq")}
        </button>
        <button
          type="button"
          className={mode === "generate" ? "primary small" : "ghost small"}
          onClick={() => setMode("generate")}
        >
          {t("generateFromSource")}
        </button>
      </div>

      {mode === "manual" ? (
        <section className="card stack">
          <div>
            <h2 style={{ marginTop: 0 }}>{t("rubricTitle")}</h2>
            <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>
              {t("rubricHint", {
                sum: rubricSum,
                total: marksTotal,
                status: rubricOk ? t("rubricOk") : t("rubricMismatch"),
              })}
            </p>
          </div>

          <label className="field">
            {t("overallStem")}
            <textarea
              className="bangla"
              rows={3}
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
            />
          </label>

          <label className="field" style={{ maxWidth: 220 }}>
            {t("totalMarks")}
            <input
              type="number"
              min={1}
              value={totalMarks}
              onChange={(e) => setTotalMarks(e.target.value)}
            />
          </label>

          {rubric.map((part, index) => (
            <div key={part.key} className="rubric-part">
              <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <strong className="bangla">
                  {part.label} — {part.title}
                </strong>
                <input
                  className="rubric-marks"
                  type="number"
                  min={0}
                  value={part.maxMarks}
                  onChange={(e) =>
                    updatePart(index, { maxMarks: Number(e.target.value) || 0 })
                  }
                />
                <span className="muted" style={{ fontSize: 13 }}>
                  {t("marksUnit")}
                </span>
              </div>
              <label className="field" style={{ marginBottom: 10 }}>
                {t("partPrompt")}
                <textarea
                  className="bangla"
                  rows={2}
                  value={part.prompt}
                  onChange={(e) => updatePart(index, { prompt: e.target.value })}
                />
              </label>
              <label className="field" style={{ marginBottom: 0 }}>
                {t("modelAnswer")}
                <textarea
                  className="bangla"
                  rows={2}
                  value={part.modelAnswer}
                  onChange={(e) => updatePart(index, { modelAnswer: e.target.value })}
                />
              </label>
            </div>
          ))}

          <button
            type="button"
            className="primary"
            disabled={!title.trim() || busy || !rubricOk}
            onClick={() => void handleCreate("manual")}
          >
            {busy ? t("working") : t("saveContinue")}
          </button>
        </section>
      ) : (
        <section className="card stack">
          <div>
            <h2 style={{ marginTop: 0 }}>{t("generateCardTitle")}</h2>
            <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>
              {t("generateCardLede")}
            </p>
          </div>

          <label className="field">
            {t("sourceTextOptional")}
            <textarea
              rows={3}
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
            />
          </label>

          <label className="field">
            {t("uploadSource")}
            <input
              type="file"
              accept=".pdf,image/*,.txt"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>

          <button
            type="button"
            className="primary"
            disabled={!title.trim() || busy}
            onClick={() => void handleCreate("generate")}
          >
            {busy ? t("working") : t("generateContinue")}
          </button>
        </section>
      )}
    </div>
  );
}
