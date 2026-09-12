"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ApiError, MAX_PAGES, apiPost, createSubmission } from "@/lib/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { usePrefs } from "@/lib/i18n";

const MAX_BYTES = 20 * 1024 * 1024;

export default function SubmitPage() {
  const router = useRouter();
  const { t } = usePrefs();
  const [questionText, setQuestionText] = useState("");
  const [subject, setSubject] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [stage, setStage] = useState<"" | "uploading" | "reading">("");
  const [error, setError] = useState("");

  const busy = stage !== "";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");

    if (files.length === 0) {
      setError(t("needImage"));
      return;
    }
    if (files.length > MAX_PAGES) {
      setError(t("tooManyPages"));
      return;
    }
    if (files.some((f) => f.size > MAX_BYTES)) {
      setError(t("tooBig"));
      return;
    }

    try {
      setStage("uploading");
      const { id } = await createSubmission(questionText, subject, files);

      // Kick the pipeline from here rather than on the server's create path, so
      // a slow model call never holds the upload request open.
      setStage("reading");
      await apiPost(`/api/submissions/${id}/process`);
      router.push(`/s/${id}`);
    } catch (err) {
      setStage("");
      setError(
        err instanceof ApiError ? err.message : t("genericError"),
      );
    }
  }

  return (
    <div className="space-y-4">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <form onSubmit={submit}>
        <Card>
          <CardHeader>
            <CardTitle>{t("submitTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="q">{t("questionLabel")}</Label>
              <p className="text-xs text-muted-foreground">{t("questionHint")}</p>
              <Textarea
                id="q"
                className="min-h-32 rounded-lg bg-card text-sm text-bangla"
                value={questionText}
                onChange={(event) => setQuestionText(event.target.value)}
                maxLength={20000}
                placeholder={
                  "উদ্দীপক: ৫ কেজি ভরের একটি বস্তুর উপর ২০ N বল প্রয়োগ করা হলো।\n" +
                  "ক) ত্বরণ কাকে বলে?\n" +
                  "খ) বল ও ত্বরণের সম্পর্ক ব্যাখ্যা করো।\n" +
                  "গ) উদ্দীপকের বস্তুটির ত্বরণ নির্ণয় করো।\n" +
                  "ঘ) ভর দ্বিগুণ হলে কী ঘটবে বিশ্লেষণ করো।"
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="subject">{t("subjectLabel")}</Label>
              <Input
                id="subject"
                type="text"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                maxLength={120}
                placeholder={t("subjectPlaceholder")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="script">{t("scriptLabel")}</Label>
              <p className="text-xs text-muted-foreground">{t("scriptHint")}</p>
              <Input
                id="script"
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                onChange={(event) =>
                  setFiles(Array.from(event.target.files ?? []).slice(0, MAX_PAGES))
                }
                required
              />

              {files.length > 0 ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  {files.map((file, index) => (
                    <Badge key={`${file.name}-${index}`} variant="outline" className="gap-2">
                      <span>{index + 1}</span>
                      <span>{file.name}</span>
                      <span className="text-muted-foreground">
                        {(file.size / 1024).toFixed(0)} KB
                      </span>
                    </Badge>
                  ))}
                </div>
              ) : null}

              {stage ? (
                <p className="text-xs text-muted-foreground">
                  {stage === "uploading" ? t("uploading") : t("reading")}
                </p>
              ) : null}
            </div>

            <Button type="submit" disabled={busy}>
              {busy ? t("working") : t("startMarking")}
            </Button>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
