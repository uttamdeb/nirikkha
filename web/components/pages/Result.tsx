"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronDownIcon, PencilLineIcon } from "lucide-react";
import Annotator from "@/components/Annotator";
import { LoadingBlock } from "@/components/feedback/loading-block";
import { StatusBadge } from "@/components/feedback/status-badge";
import { PageShell } from "@/components/layout/page-shell";
import ScriptText from "@/components/ScriptText";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
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
import { SKILL_KEY, statusKey, usePrefs, type StringKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Each refusal cause gets its own next step — a student who photographed the
    wrong thing needs different advice from one whose photo was out of focus. */
const FIX_FOR: Record<string, StringKey> = {
  not_a_script: "fixNotAScript",
  rotated: "fixRotated",
  too_blurry: "fixTooBlurry",
  blank: "fixBlank",
};

interface ResultPageProps {
  id: string;
  isTeacher: boolean;
}

export default function ResultPage({ id, isTeacher }: ResultPageProps) {
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
  const [transcriptOpen, setTranscriptOpen] = useState(isTeacher);

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
      setDraft((current) => {
        const next = { ...current };
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
      setLineEdit((current) => {
        const next = { ...current };
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

  async function addAnnotation(annotation: Omit<Annotation, "id">) {
    await apiPost(`/api/submissions/${id}/annotations`, annotation);
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

  const pageActions = (
    <>
      {sub ? (
        <StatusBadge status={sub.status} label={t(statusKey(sub.status, isTeacher))} />
      ) : null}
      <Button asChild variant="outline" size="sm">
        <Link href={isTeacher ? "/review" : "/inbox"}>{t("back")}</Link>
      </Button>
    </>
  );

  if (!sub) {
    return (
      <PageShell
        title={t("reviewStudioTitle")}
        description={t("reviewStudioLede")}
        actions={pageActions}
      >
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>{t("loadFailed")}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : (
          <div className="flex min-h-[60vh] items-center justify-center">
            <LoadingBlock rows={5} label={t("working")} />
          </div>
        )}
      </PageShell>
    );
  }

  const pending = sub.lines.filter((line) => line.needs_clarification);
  const working = ["received", "ocr_running", "grading"].includes(sub.status);
  const totalRatio =
    sub.total_awarded === null || sub.total_max === 0 ? null : sub.total_awarded / sub.total_max;

  return (
    <PageShell
      title={t("reviewStudioTitle")}
      description={t("reviewStudioLede")}
      actions={pageActions}
      className="min-h-0"
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          <Card className="border-border/70">
            <CardHeader className="gap-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle>{sub.subject || t("scriptWord")}</CardTitle>
                  <CardDescription className="text-sm text-muted-foreground">
                    {sub.question_text || t("scriptWord")}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {sub.needs_human_review ? (
                    <Badge
                      variant="outline"
                      className="border-transparent bg-[color-mix(in_oklch,var(--status-review),white_75%)] text-[color-mix(in_oklch,var(--status-review),black_35%)]"
                    >
                      {t("reviewNeeded")}
                    </Badge>
                  ) : null}
                  <Badge variant="outline">{t("pagesLabel", { n: sub.image_urls.length })}</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              {sub.ocr_engine ? <Badge variant="outline">ocr: {sub.ocr_engine}</Badge> : null}
              {sub.grader_model ? (
                <Badge variant="outline">grader: {sub.grader_model}</Badge>
              ) : null}
            </CardContent>
          </Card>

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>{t("genericError")}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {sub.status === "failed" ? (
            <Alert variant="destructive">
              <AlertTitle>{sub.error || t("unreadable")}</AlertTitle>
              <AlertDescription>
                {sub.review_reason && FIX_FOR[sub.review_reason] ? (
                  <p>
                    <strong>{t("whatToDo")}:</strong> {t(FIX_FOR[sub.review_reason])}
                  </p>
                ) : null}
                <p>
                  <Link href="/submit" className="underline underline-offset-4">
                    {t("submitTitle")}
                  </Link>
                </p>
              </AlertDescription>
            </Alert>
          ) : null}

          {sub.marks_stale && isTeacher ? (
            <Alert className="border-[color-mix(in_oklch,var(--status-review),white_35%)] bg-[color-mix(in_oklch,var(--status-review),white_88%)]">
              <AlertTitle>{t("staleWarning")}</AlertTitle>
              <AlertDescription className="pt-2">
                <Button
                  size="sm"
                  disabled={regrading}
                  onClick={() => void regrade()}
                >
                  {regrading ? t("regrading") : t("regrade")}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          {working ? (
            <Alert>
              <AlertTitle>{t(statusKey(sub.status, isTeacher))}</AlertTitle>
              <AlertDescription>{t("working")}</AlertDescription>
            </Alert>
          ) : null}

          {pending.length > 0 ? (
            <Card className="border-[color-mix(in_oklch,var(--status-review),white_35%)] bg-[color-mix(in_oklch,var(--status-review),white_92%)]">
              <CardHeader>
                <CardTitle>{t("cannotRead", { n: pending.length })}</CardTitle>
                <CardDescription>{t("cannotReadLede")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Alert>
                  <AlertTitle>{t(statusKey("awaiting_student", isTeacher))}</AlertTitle>
                  <AlertDescription>{t("cannotReadLede")}</AlertDescription>
                </Alert>
                {pending.map((line) => (
                  <div
                    key={line.index}
                    className="space-y-3 rounded-2xl border border-border/70 bg-card p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{t("lineN", { n: line.index + 1 })}</Badge>
                      {line.legibility !== null ? (
                        <Badge variant="outline">
                          {t("legibilityLabel", { n: line.legibility.toFixed(2) })}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="rounded-xl bg-paper px-3 py-2 text-sm leading-7 text-bangla">
                      <ScriptText text={line.text} />
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        id={`fix-${line.index}`}
                        value={draft[line.index] ?? ""}
                        maxLength={2000}
                        placeholder={t("whatDoesItSay")}
                        className="text-bangla"
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            [line.index]: event.target.value,
                          }))
                        }
                      />
                      <Button
                        disabled={busy || !(draft[line.index] ?? "").trim()}
                        onClick={() => void clarify(line.index)}
                      >
                        {t("fixIt")}
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {(sub.image_urls?.length ?? 0) > 0 ? (
            <Card className="border-border/70">
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <CardTitle>{t("originalImage")}</CardTitle>
                    <CardDescription>
                      {isTeacher ? t("annotateHint") : t("pagesLabel", { n: sub.image_urls.length })}
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{t("pagesLabel", { n: sub.image_urls.length })}</Badge>
                    {sub.annotations.length > 0 ? (
                      <Badge variant="outline">
                        {t("annotationsN", { n: sub.annotations.length })}
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="bg-paper rounded-2xl border border-border/70 p-3">
                  <div className="grid gap-4">
                    {sub.image_urls.map((url, index) => (
                      <Annotator
                        key={url}
                        url={url}
                        page={index}
                        annotations={sub.annotations}
                        editable={isTeacher && sub.status !== "released"}
                        onAdd={addAnnotation}
                        onDelete={removeAnnotation}
                      />
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-border/70">
              <CardHeader>
                <CardTitle>{t("originalImage")}</CardTitle>
                <CardDescription>{t("noImagesDescription")}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="bg-paper rounded-2xl border border-dashed border-border/80 px-6 py-12 text-center text-sm text-muted-foreground">
                  {t("noImagesTitle")}
                </div>
              </CardContent>
            </Card>
          )}

          <Collapsible open={transcriptOpen} onOpenChange={setTranscriptOpen}>
            <Card className="border-border/70">
              <CardHeader className="gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <CardTitle>{t("transcript", { n: sub.lines.length })}</CardTitle>
                    {isTeacher ? (
                      <CardDescription>{t("editTranscriptHint")}</CardDescription>
                    ) : null}
                  </div>
                  <CollapsibleTrigger asChild>
                    <Button variant="outline" size="sm">
                      <span>
                        {isTeacher ? t("editTranscript") : t("transcript", { n: sub.lines.length })}
                      </span>
                      <ChevronDownIcon
                        className={cn("size-4 transition-transform", transcriptOpen && "rotate-180")}
                      />
                    </Button>
                  </CollapsibleTrigger>
                </div>
              </CardHeader>
              <CollapsibleContent>
                <CardContent className="space-y-3">
                  {sub.lines.map((line) => {
                    const shown = line.clarified_text ?? line.text;
                    const editing = lineEdit[line.index] !== undefined;
                    return (
                      <div
                        key={line.index}
                        className={cn(
                          "space-y-3 rounded-2xl border p-4",
                          line.needs_clarification
                            ? "border-[color-mix(in_oklch,var(--status-review),white_35%)] bg-[color-mix(in_oklch,var(--status-review),white_92%)]"
                            : line.clarified_text
                              ? "border-[color-mix(in_oklch,var(--status-graded),white_35%)] bg-[color-mix(in_oklch,var(--status-graded),white_92%)]"
                              : "border-border/70 bg-card",
                        )}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">{t("lineN", { n: line.index + 1 })}</Badge>
                            {line.clarified_text ? (
                              <Badge variant="outline">{t("fixIt")}</Badge>
                            ) : null}
                            {line.needs_clarification ? (
                              <Badge
                                variant="outline"
                                className="border-transparent bg-[color-mix(in_oklch,var(--status-review),white_75%)] text-[color-mix(in_oklch,var(--status-review),black_35%)]"
                              >
                                {t("reviewNeeded")}
                              </Badge>
                            ) : null}
                          </div>
                          {isTeacher && !editing ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setLineEdit((current) => ({
                                  ...current,
                                  [line.index]: shown,
                                }))
                              }
                            >
                              <PencilLineIcon className="size-4" />
                              {t("editTranscript")}
                            </Button>
                          ) : null}
                        </div>

                        {editing ? (
                          <div className="space-y-2">
                            <Textarea
                              value={lineEdit[line.index]}
                              autoFocus
                              maxLength={2000}
                              rows={3}
                              className="min-h-24 rounded-lg bg-card text-sm text-bangla"
                              onChange={(event) =>
                                setLineEdit((current) => ({
                                  ...current,
                                  [line.index]: event.target.value,
                                }))
                              }
                            />
                            <div className="flex flex-wrap gap-2">
                              <Button disabled={busy} onClick={() => void editLine(line.index)}>
                                {t("saveLine")}
                              </Button>
                              <Button
                                variant="outline"
                                onClick={() =>
                                  setLineEdit((current) => {
                                    const next = { ...current };
                                    delete next[line.index];
                                    return next;
                                  })
                                }
                              >
                                {t("cancel")}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <div className="rounded-xl bg-paper px-3 py-2 text-sm leading-7 text-bangla">
                              <ScriptText text={shown} />
                            </div>
                            {line.clarified_text ? (
                              <div className="text-sm text-muted-foreground">
                                <strong>{t("readAsBefore")}</strong>
                                <span className="ml-1 text-bangla">
                                  <ScriptText text={line.text} />
                                </span>
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </div>

        <aside className="space-y-4 xl:self-start">
          <Card className="border-border/70">
            <CardHeader>
              <CardTitle>{t("studentDetails")}</CardTitle>
              <CardDescription>{t("statusLabelShort")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <p className="font-heading text-base font-semibold">
                  {personName(sub.student) || "—"}
                </p>
                {sub.student?.email ? (
                  <p className="text-sm text-muted-foreground">{sub.student.email}</p>
                ) : null}
              </div>
              <StatusBadge status={sub.status} label={t(statusKey(sub.status, isTeacher))} />
            </CardContent>
          </Card>

          {sub.marks.length > 0 ? (
            <Card className="border-border/70">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <CardTitle>{t("partScores")}</CardTitle>
                    <CardDescription>{t("scoreLabel")}</CardDescription>
                  </div>
                  <div
                    className={cn(
                      "rounded-2xl px-3 py-2 text-right",
                      totalRatio === null
                        ? "bg-muted"
                        : totalRatio >= 0.7
                          ? "bg-[color-mix(in_oklch,var(--status-graded),white_78%)]"
                          : totalRatio >= 0.4
                            ? "bg-[color-mix(in_oklch,var(--status-review),white_78%)]"
                            : "bg-[color-mix(in_oklch,var(--status-failed),white_82%)]",
                    )}
                  >
                    <p className="font-heading text-xl font-semibold tabular-nums">
                      {sub.total_awarded ?? "—"}
                      <span className="ml-1 text-sm font-normal text-muted-foreground">
                        / {sub.total_max}
                      </span>
                    </p>
                    {sub.needs_human_review ? (
                      <p className="text-xs text-muted-foreground">{t("reviewNeeded")}</p>
                    ) : null}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                {sub.marks.map((mark) => (
                  <MarkRow
                    key={mark.part}
                    mark={mark}
                    editable={isTeacher && sub.status !== "released"}
                    busy={busy}
                    onChange={(value) => void override(mark.part, value)}
                    onRewrite={(reason, improvement) =>
                      rewriteMark(mark.part, reason, improvement)
                    }
                  />
                ))}
              </CardContent>
            </Card>
          ) : null}

          {sub.feedback ? (
            <Card className="border-border/70">
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="space-y-1">
                    <CardTitle>{t("agentFeedback")}</CardTitle>
                    <CardDescription>
                      {sub.feedback_edited_by
                        ? t("editedBy", { who: personName(sub.feedback_edited_by) })
                        : t("byAgent")}
                    </CardDescription>
                  </div>
                  {isTeacher && sub.status !== "released" && !editingFeedback ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setFeedbackDraft(sub.feedback ?? "");
                        setEditingFeedback(true);
                      }}
                    >
                      {t("editFeedback")}
                    </Button>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {editingFeedback ? (
                  <>
                    <Textarea
                      value={feedbackDraft}
                      maxLength={4000}
                      rows={5}
                      className="min-h-28 rounded-lg bg-card text-sm text-bangla"
                      onChange={(event) => setFeedbackDraft(event.target.value)}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button disabled={busy} onClick={() => void saveFeedback()}>
                        {t("saveLine")}
                      </Button>
                      <Button variant="outline" onClick={() => setEditingFeedback(false)}>
                        {t("cancel")}
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="rounded-xl bg-paper px-3 py-2 text-sm leading-7 text-bangla">
                      <ScriptText text={sub.feedback} />
                    </div>
                    {sub.ai_feedback && sub.ai_feedback !== sub.feedback ? (
                      <Collapsible>
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" size="sm" className="justify-start px-0">
                            {t("showAgentWording")}
                          </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="pt-2">
                          <div className="rounded-xl border border-border/70 bg-card px-3 py-2 text-sm leading-7 text-bangla">
                            <ScriptText text={sub.ai_feedback} />
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    ) : null}
                  </>
                )}
              </CardContent>
            </Card>
          ) : null}

          {isTeacher ? (
            <Card className="border-border/70">
              <CardHeader>
                <CardTitle>{t("teacherFeedbackLabel")}</CardTitle>
                <CardDescription>{t("teacherFeedbackHint")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  value={note ?? sub.teacher_feedback ?? ""}
                  maxLength={2000}
                  rows={5}
                  className="min-h-24 rounded-lg bg-card text-sm text-bangla"
                  onChange={(event) => setNote(event.target.value)}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button disabled={busy} onClick={() => void saveNote()}>
                    {t("saveFeedback")}
                  </Button>
                  {noteSaved ? (
                    <Badge variant="outline">{t("saved")}</Badge>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ) : sub.teacher_feedback ? (
            <Card className="border-border/70">
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="space-y-1">
                    <CardTitle>{t("teacherFeedbackLabel")}</CardTitle>
                    {sub.reviewed_by ? (
                      <CardDescription>
                        {t("writtenBy", { who: personName(sub.reviewed_by) })}
                      </CardDescription>
                    ) : null}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="rounded-xl bg-paper px-3 py-2 text-sm leading-7 text-bangla">
                  <ScriptText text={sub.teacher_feedback} />
                </div>
              </CardContent>
            </Card>
          ) : null}

          {isTeacher ? (
            <Card className="border-border/70 xl:sticky xl:top-6">
              <CardHeader>
                <CardTitle>{t("teacherActions")}</CardTitle>
                <CardDescription>{t("releaseHint")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button
                  className="w-full"
                  disabled={regrading || sub.status === "released"}
                  onClick={() => void regrade()}
                >
                  {regrading ? t("regrading") : t("regrade")}
                </Button>
                <Button
                  className="w-full"
                  disabled={busy || sub.marks_stale || sub.status !== "awaiting_teacher"}
                  onClick={() => void release()}
                >
                  {t("releaseResult")}
                </Button>
                {sub.status !== "awaiting_teacher" ? (
                  <p className="text-xs text-muted-foreground">
                    {t(statusKey(sub.status, true))}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </aside>
      </div>
    </PageShell>
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

  useEffect(() => {
    setReason(mark.reason);
    setImprovement(mark.improvement);
  }, [mark.reason, mark.improvement]);

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
      <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-bangla text-lg font-semibold">{mark.bangla}</p>
            <p className="text-xs text-muted-foreground">
              {t(SKILL_KEY[mark.part] as StringKey)}
            </p>
          </div>
          <Badge variant="outline">
            {mark.awarded} / {mark.max_marks}
          </Badge>
        </div>

        <div className="space-y-2">
          <label htmlFor={`r-${mark.part}`} className="text-xs font-medium text-muted-foreground">
            {t("reasonLabel")}
          </label>
          <Textarea
            id={`r-${mark.part}`}
            value={reason}
            maxLength={2000}
            rows={4}
            className="min-h-24 rounded-lg bg-paper text-sm text-bangla"
            onChange={(event) => setReason(event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor={`i-${mark.part}`} className="text-xs font-medium text-muted-foreground">
            {t("improvementLabel")}
          </label>
          <Textarea
            id={`i-${mark.part}`}
            value={improvement}
            maxLength={2000}
            rows={3}
            className="min-h-20 rounded-lg bg-paper text-sm text-bangla"
            onChange={(event) => setImprovement(event.target.value)}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button disabled={saving} onClick={() => void save()}>
            {t("saveLine")}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setReason(mark.reason);
              setImprovement(mark.improvement);
              setEditing(false);
            }}
          >
            {t("cancel")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-bangla text-lg font-semibold">{mark.bangla}</p>
          <p className="text-xs text-muted-foreground">{t(SKILL_KEY[mark.part] as StringKey)}</p>
        </div>
        <div className="shrink-0">
          {editable ? (
            <Select
              value={String(mark.awarded)}
              disabled={busy}
              onValueChange={(value) => onChange(Number(value))}
            >
              <SelectTrigger className="min-w-18 rounded-lg bg-paper">
                <SelectValue aria-label={mark.bangla} />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: mark.max_marks + 1 }, (_, index) => (
                  <SelectItem key={index} value={String(index)}>
                    {index}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Badge variant="outline">
              {mark.awarded} / {mark.max_marks}
            </Badge>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {mark.ai_awarded !== null && mark.ai_awarded !== mark.awarded ? (
          <Badge
            variant="outline"
            className="border-transparent bg-[color-mix(in_oklch,var(--status-review),white_75%)] text-[color-mix(in_oklch,var(--status-review),black_35%)]"
          >
            {t("overriddenBadge")} · {t("aiProposed", { n: mark.ai_awarded })}
          </Badge>
        ) : null}
        {rewritten ? (
          <Badge variant="outline">
            {mark.edited_by
              ? t("editedBy", { who: personName(mark.edited_by) })
              : t("rewritten")}
          </Badge>
        ) : null}
      </div>

      <div className="space-y-2 text-sm leading-7">
        <div className="rounded-xl bg-paper px-3 py-2 text-bangla">
          <ScriptText text={mark.reason} />
        </div>
        {mark.improvement ? (
          <div className="rounded-xl border border-border/70 bg-card px-3 py-2 text-bangla">
            <strong>{t("howToFullMarks")}</strong>
            <ScriptText text={mark.improvement} />
          </div>
        ) : null}
        {mark.evidence_lines.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("evidenceLines", { lines: mark.evidence_lines.map((n) => n + 1).join(", ") })}
          </p>
        ) : null}
      </div>

      {rewritten ? (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="justify-start px-0">
              {t("showAgentWording")}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 pt-2">
            <div className="rounded-xl border border-border/70 bg-paper px-3 py-2 text-sm leading-7 text-bangla">
              <ScriptText text={mark.ai_reason} />
            </div>
            {mark.ai_improvement ? (
              <div className="rounded-xl border border-border/70 bg-paper px-3 py-2 text-sm leading-7 text-bangla">
                <ScriptText text={mark.ai_improvement} />
              </div>
            ) : null}
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      {editable ? (
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          {t("editReason")}
        </Button>
      ) : null}
    </div>
  );
}
