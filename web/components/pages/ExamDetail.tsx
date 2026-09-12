"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import { EmptyState } from "@/components/feedback/empty-state";
import { LoadingBlock } from "@/components/feedback/loading-block";
import { StatusBadge } from "@/components/feedback/status-badge";
import { PageShell } from "@/components/layout/page-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePrefs } from "@/lib/i18n";

interface RubricPart {
  key: "ka" | "kha" | "ga" | "gha";
  label: string;
  title: string;
  prompt: string;
  modelAnswer: string;
  maxMarks: number;
}

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
  const id = typeof params.id === "string" ? params.id : params.id?.[0];
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
  }, [id, t]);

  function getExamStatusLabel(status: string): string {
    if (status === "published") return t("published");
    if (status === "closed") return t("closed");
    return t("draft");
  }

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

  const content = !exam ? (
    error ? (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    ) : (
      <LoadingBlock rows={4} className="max-w-none" />
    )
  ) : (
    <div className="space-y-4">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {notice ? (
        <Alert>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={exam.status} label={getExamStatusLabel(exam.status)} />
        {exam.exam_code ? (
          <Badge variant="outline" className="font-mono">
            {exam.exam_code}
          </Badge>
        ) : null}
        {exam.batch ? (
          <Badge variant="outline">{exam.batch.name}</Badge>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("questionsTitle")}</CardTitle>
          <CardDescription>{t("createExamLede")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {exam.questions.length === 0 ? (
            <EmptyState
              title={t("noQuestionsYet")}
              description={t("noQuestionsYetLede")}
              className="border-0 bg-transparent px-0 py-6 shadow-none"
            />
          ) : (
            exam.questions.map((question, index) => {
              const rubric = Array.isArray(question.rubric_json)
                ? (question.rubric_json as RubricPart[])
                : [];

              return (
                <div
                  key={question.id}
                  className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">CQ {index + 1}</Badge>
                    <Badge variant="outline" className="tabular-nums">
                      {question.total_marks} {t("marksUnit")}
                    </Badge>
                    <Badge variant="outline">{question.source}</Badge>
                    <StatusBadge
                      status={question.approved ? "approved" : "needs_review"}
                      label={question.approved ? t("approved") : t("pendingApproval")}
                    />
                    {!question.approved ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void approve(question.id)}
                      >
                        {t("approve")}
                      </Button>
                    ) : null}
                  </div>

                  <p className="whitespace-pre-wrap text-sm text-bangla">
                    {question.prompt_text || "—"}
                  </p>

                  {rubric.length > 0 ? (
                    <div className="grid gap-3 lg:grid-cols-2">
                      {rubric.map((part) => (
                        <div
                          key={part.key}
                          className="space-y-2 rounded-lg border border-border/60 bg-card p-3"
                        >
                          <p className="font-medium text-bangla">
                            {part.label} - {part.title}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {part.maxMarks} {t("marksUnit")}
                          </p>
                          <p className="whitespace-pre-wrap text-sm text-bangla">
                            {part.prompt || "—"}
                          </p>
                          <p className="whitespace-pre-wrap text-xs text-muted-foreground text-bangla">
                            {part.modelAnswer || "—"}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {exam.status !== "closed" ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("publishExam")}</CardTitle>
            <CardDescription>{t("publishExamLede")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="max-w-md space-y-2">
              <Label htmlFor="batch-id">{t("assignBatch")}</Label>
              <Select value={batchId} onValueChange={setBatchId}>
                <SelectTrigger id="batch-id" className="w-full rounded-lg bg-card">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {batches.map((batch) => (
                    <SelectItem key={batch.id} value={batch.id}>
                      {batch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <form
              onSubmit={publish}
              className="flex flex-wrap items-center gap-2"
            >
              <Button type="submit" disabled={busy || !batchId}>
                {t("publishExam")}
              </Button>
              {exam.status === "published" ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void closeExam()}
                >
                  {t("closeExam")}
                </Button>
              ) : null}
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );

  return (
    <PageShell
      title={exam?.title ?? t("examsTitle")}
      description={
        exam
          ? `${exam.exam_code || "—"} · ${getExamStatusLabel(exam.status)}`
          : t("examsLede")
      }
      breadcrumbs={[
        { label: t("examsTitle"), href: "/exams" },
        { label: exam?.title ?? t("actionOpen") },
      ]}
    >
      {content}
    </PageShell>
  );
}
