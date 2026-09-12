import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, apiPost, API_BASE, supabase } from "../lib/api";
import { usePrefs } from "../lib/i18n";

const DEFAULT_RUBRIC = [
  { key: "ka", label: "ক", title: "জ্ঞান", prompt: "", modelAnswer: "", maxMarks: 1 },
  { key: "kha", label: "খ", title: "অনুধাবন", prompt: "", modelAnswer: "", maxMarks: 2 },
  { key: "ga", label: "গ", title: "প্রয়োগ", prompt: "", modelAnswer: "", maxMarks: 3 },
  { key: "gha", label: "ঘ", title: "উচ্চতর দক্ষতা", prompt: "", modelAnswer: "", maxMarks: 4 },
];

export default function ExamNewPage() {
  const { t } = usePrefs();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"manual" | "generate">("manual");
  const [title, setTitle] = useState("");
  const [promptText, setPromptText] = useState("");
  const [rubric, setRubric] = useState(DEFAULT_RUBRIC);
  const [sourceText, setSourceText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function updatePart(index: number, field: "prompt" | "modelAnswer", value: string) {
    setRubric((prev) => prev.map((p, i) => (i === index ? { ...p, [field]: value } : p)));
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError("");
    try {
      const created = await apiPost<{ exam: { id: string } }>("/api/teacher/exams", {
        title: title.trim(),
        publish_mode: null,
      });
      const examId = created.exam.id;

      if (mode === "manual") {
        await apiPost(`/api/teacher/exams/${examId}/questions`, {
          prompt_text: promptText,
          total_marks: 10,
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
          throw new ApiError(body.detail || "Generate failed", response.status);
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
      <Link to="/exams">{t("back")}</Link>
      <h1>{t("createExam")}</h1>
      {error && <p className="error">{error}</p>}

      <div className="row" style={{ gap: 8 }}>
        <button
          type="button"
          className={mode === "manual" ? "primary small" : "ghost small"}
          onClick={() => setMode("manual")}
        >
          {t("manualQuestion")}
        </button>
        <button
          type="button"
          className={mode === "generate" ? "primary small" : "ghost small"}
          onClick={() => setMode("generate")}
        >
          {t("generateQuestions")}
        </button>
      </div>

      <form className="card stack" onSubmit={create}>
        <label>
          {t("examTitle")}
          <input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>

        {mode === "manual" ? (
          <>
            <label>
              {t("promptText")}
              <textarea
                rows={4}
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
              />
            </label>
            {rubric.map((part, index) => (
              <div key={part.key} className="stack" style={{ gap: 6 }}>
                <strong>
                  {part.label} ({part.maxMarks}) — {part.title}
                </strong>
                <input
                  placeholder={t("partPrompt")}
                  value={part.prompt}
                  onChange={(e) => updatePart(index, "prompt", e.target.value)}
                />
                <input
                  placeholder={t("modelAnswer")}
                  value={part.modelAnswer}
                  onChange={(e) => updatePart(index, "modelAnswer", e.target.value)}
                />
              </div>
            ))}
          </>
        ) : (
          <>
            <label>
              {t("sourceText")}
              <textarea
                rows={5}
                value={sourceText}
                onChange={(e) => setSourceText(e.target.value)}
              />
            </label>
            <label>
              File
              <input
                type="file"
                accept="image/*,.pdf,.txt"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </label>
          </>
        )}

        <button className="primary" disabled={busy} type="submit">
          {t("createExam")}
        </button>
      </form>
    </div>
  );
}
