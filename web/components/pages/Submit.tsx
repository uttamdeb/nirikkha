"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ApiError, MAX_PAGES, apiPost, createSubmission } from "@/lib/api";
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
    <>
      <h1>{t("submitTitle")}</h1>
      <p className="lede">{t("submitLede")}</p>

      {error && <div className="banner err">{error}</div>}

      <form onSubmit={submit}>
        <div className="card">
          <div className="field">
            <label htmlFor="q">{t("questionLabel")}</label>
            <p className="muted" style={{ margin: "0 0 7px" }}>{t("questionHint")}</p>
            <textarea
              id="q"
              value={questionText}
              onChange={(e) => setQuestionText(e.target.value)}
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

          <div className="field">
            <label htmlFor="subject">{t("subjectLabel")}</label>
            <input
              id="subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={120}
              placeholder={t("subjectPlaceholder")}
            />
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="script">{t("scriptLabel")}</label>
            <p className="muted" style={{ margin: "0 0 7px" }}>{t("scriptHint")}</p>
            <input
              id="script"
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, MAX_PAGES))}
              required
            />
            {files.length > 0 && (
              <ul className="pages">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`}>
                    <span className="n">{i + 1}</span>
                    <span className="name">{f.name}</span>
                    <span className="muted">{(f.size / 1024).toFixed(0)} KB</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="row">
          <button type="submit" disabled={busy}>
            {busy ? <span className="spin" /> : t("startMarking")}
          </button>
          {stage === "uploading" && <span className="muted">{t("uploading")}</span>}
{stage === "reading" && <span className="muted">{t("reading")}</span>}
        </div>
      </form>
    </>
  );
}
