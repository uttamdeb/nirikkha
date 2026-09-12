"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiPost, API_BASE, supabase } from "@/lib/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { usePrefs } from "@/lib/i18n";

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
  const router = useRouter();
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

      router.push(`/exams/${examId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("examDetails")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="exam-title">{t("examTitle")}</Label>
            <Input
              id="exam-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t("examTitlePlaceholder")}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="publish-mode">{t("publishModeExam")}</Label>
            <Select
              value={publishMode}
              onValueChange={(value) =>
                setPublishMode(value as "admin" | "auto" | "inherit")
              }
            >
              <SelectTrigger id="publish-mode" className="w-full rounded-lg bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inherit">{t("publishInherit")}</SelectItem>
                <SelectItem value="admin">{t("publishAdmin")}</SelectItem>
                <SelectItem value="auto">{t("publishAuto")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={mode === "manual" ? "default" : "outline"}
          onClick={() => setMode("manual")}
        >
          {t("manualCq")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "generate" ? "default" : "outline"}
          onClick={() => setMode("generate")}
        >
          {t("generateFromSource")}
        </Button>
      </div>

      {mode === "manual" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-bangla">{t("rubricTitle")}</CardTitle>
            <CardDescription>
              {t("rubricHint", {
                sum: rubricSum,
                total: marksTotal,
                status: rubricOk ? t("rubricOk") : t("rubricMismatch"),
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="prompt-text">{t("overallStem")}</Label>
              <Textarea
                id="prompt-text"
                className="min-h-24 rounded-lg bg-card text-sm text-bangla"
                rows={4}
                value={promptText}
                onChange={(event) => setPromptText(event.target.value)}
              />
            </div>

            <div className="max-w-44 space-y-2">
              <Label htmlFor="total-marks">{t("totalMarks")}</Label>
              <Input
                id="total-marks"
                type="number"
                min={1}
                value={totalMarks}
                onChange={(event) => setTotalMarks(event.target.value)}
              />
            </div>

            {rubric.map((part, index) => (
              <div
                key={part.key}
                className="space-y-3 rounded-xl border border-border/70 bg-muted/25 p-4"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <p className="font-medium text-bangla">
                    {part.label} - {part.title}
                  </p>
                  <div className="flex items-center gap-2">
                    <Input
                      className="w-20"
                      type="number"
                      min={0}
                      value={part.maxMarks}
                      onChange={(event) =>
                        updatePart(index, {
                          maxMarks: Number(event.target.value) || 0,
                        })
                      }
                    />
                    <span className="text-xs text-muted-foreground">{t("marksUnit")}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`${part.key}-prompt`}>{t("partPrompt")}</Label>
                  <Textarea
                    id={`${part.key}-prompt`}
                    className="min-h-20 rounded-lg bg-card text-sm text-bangla"
                    rows={3}
                    value={part.prompt}
                    onChange={(event) =>
                      updatePart(index, { prompt: event.target.value })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`${part.key}-answer`}>{t("modelAnswer")}</Label>
                  <Textarea
                    id={`${part.key}-answer`}
                    className="min-h-20 rounded-lg bg-card text-sm text-bangla"
                    rows={3}
                    value={part.modelAnswer}
                    onChange={(event) =>
                      updatePart(index, { modelAnswer: event.target.value })
                    }
                  />
                </div>
              </div>
            ))}

            <Button
              type="button"
              disabled={!title.trim() || busy || !rubricOk}
              onClick={() => void handleCreate("manual")}
            >
              {busy ? t("working") : t("saveContinue")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t("generateCardTitle")}</CardTitle>
            <CardDescription>{t("generateCardLede")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="source-text">{t("sourceTextOptional")}</Label>
              <Textarea
                id="source-text"
                className="min-h-24 rounded-lg bg-card text-sm"
                rows={4}
                value={sourceText}
                onChange={(event) => setSourceText(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="source-file">{t("uploadSource")}</Label>
              <Input
                id="source-file"
                type="file"
                accept=".pdf,image/*,.txt"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </div>

            <Button
              type="button"
              disabled={!title.trim() || busy}
              onClick={() => void handleCreate("generate")}
            >
              {busy ? t("working") : t("generateContinue")}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
