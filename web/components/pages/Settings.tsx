"use client";

import { useEffect, useState, type FormEvent } from "react";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { usePrefs } from "@/lib/i18n";

type OrgSettings = {
  bot_username: string | null;
  bot_connected: boolean;
  has_telegram_token: boolean;
  telegram_bot_token_masked: string | null;
  ocr_confidence_threshold: number;
  publish_mode: "auto" | "admin";
  ai_from_env: boolean;
};

export default function SettingsPage() {
  const { t } = usePrefs();
  const [step, setStep] = useState<1 | 2>(1);
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [token, setToken] = useState("");
  const [threshold, setThreshold] = useState("0.65");
  const [publishMode, setPublishMode] = useState<"auto" | "admin">("admin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiGet<OrgSettings>("/api/teacher/settings");
        setSettings(data);
        setThreshold(String(data.ocr_confidence_threshold ?? 0.65));
        setPublishMode(data.publish_mode || "admin");
      } catch (err) {
        setError(err instanceof Error && err.message ? err.message : t("loadFailed"));
      }
    })();
  }, [t]);

  async function connect(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      // connect_webhook persists the token and calls Telegram setWebhook.
      const result = await apiPost<{ username: string; bot_connected: boolean }>(
        "/api/teacher/telegram/connect",
        token.trim() ? { token: token.trim() } : {},
      );
      setNotice(`@${result.username}`);
      setToken("");
      const data = await apiGet<OrgSettings>("/api/teacher/settings");
      setSettings(data);
    } catch (err) {
      // Network/CORS failures are plain Errors ("Failed to fetch"), not ApiError.
      setError(err instanceof Error && err.message ? err.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function saveGrading(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await apiPatch<OrgSettings>("/api/teacher/settings", {
        ocr_confidence_threshold: Number(threshold),
        publish_mode: publishMode,
      });
      setSettings(data);
      setNotice(t("saved"));
    } catch (err) {
      // Network/CORS failures are plain Errors ("Failed to fetch"), not ApiError.
      setError(err instanceof Error && err.message ? err.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div>
        <h1>{t("settingsTitle")}</h1>
        <p className="lede">{t("settingsLede")}</p>
      </div>

      <div className="row" style={{ gap: 8 }}>
        <button
          type="button"
          className={step === 1 ? "primary small" : "ghost small"}
          onClick={() => setStep(1)}
        >
          1. {t("stepTelegram")}
        </button>
        <button
          type="button"
          className={step === 2 ? "primary small" : "ghost small"}
          onClick={() => setStep(2)}
        >
          2. {t("stepGrading")}
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {notice && <p className="muted">{notice}</p>}

      {step === 1 && (
        <form className="card stack" onSubmit={connect}>
          <div className="row">
            <span className={`pill ${settings?.bot_connected ? "done" : ""}`}>
              {settings?.bot_connected ? t("botConnected") : t("botNotConnected")}
            </span>
            {settings?.bot_username && (
              <span className="muted">@{settings.bot_username}</span>
            )}
          </div>
          <label>
            {t("botToken")}
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={settings?.telegram_bot_token_masked || "123456:ABC…"}
              autoComplete="off"
            />
          </label>
          <p className="muted" style={{ fontSize: 13 }}>{t("botTokenHint")}</p>
          <p className="muted" style={{ fontSize: 13 }}>{t("aiFromEnv")}</p>
          <button className="primary" disabled={busy} type="submit">
            {t("connectWebhook")}
          </button>
        </form>
      )}

      {step === 2 && (
        <form className="card stack" onSubmit={saveGrading}>
          <label>
            {t("ocrThreshold")}
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />
          </label>
          <label>
            {t("publishMode")}
            <select
              value={publishMode}
              onChange={(e) => setPublishMode(e.target.value as "auto" | "admin")}
            >
              <option value="admin">{t("publishAdmin")}</option>
              <option value="auto">{t("publishAuto")}</option>
            </select>
          </label>
          <button className="primary" disabled={busy} type="submit">
            {t("saveSettings")}
          </button>
        </form>
      )}
    </div>
  );
}
