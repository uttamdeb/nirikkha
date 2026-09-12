"use client";

import { useEffect, useState, type FormEvent } from "react";
import { CheckIcon } from "lucide-react";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { usePrefs } from "@/lib/i18n";

type AiProvider = "gemini" | "openai" | "claude";

type OrgSettings = {
  bot_username: string | null;
  bot_connected: boolean;
  has_telegram_token: boolean;
  telegram_bot_token_masked: string | null;
  ocr_confidence_threshold: number;
  publish_mode: "auto" | "admin";
  ai_from_env: boolean;
  ai_enabled?: boolean;
  ocr_provider?: string;
  ocr_model?: string;
  grader_provider?: string;
  grader_model?: string;
  has_gemini_key?: boolean;
  has_openai_key?: boolean;
};

function mapProvider(raw: string | undefined): AiProvider {
  const p = (raw || "gemini").toLowerCase();
  if (p === "openai" || p === "openrouter") return "openai";
  if (p === "claude" || p === "anthropic") return "claude";
  return "gemini";
}

export default function SettingsPage() {
  const { t } = usePrefs();
  const [step, setStep] = useState(1);
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [token, setToken] = useState("");
  const [showChangeToken, setShowChangeToken] = useState(false);
  const [aiProvider, setAiProvider] = useState<AiProvider>("gemini");
  const [threshold, setThreshold] = useState("0.65");
  const [publishMode, setPublishMode] = useState<"auto" | "admin">("admin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    const data = await apiGet<OrgSettings>("/api/teacher/settings");
    setSettings(data);
    setThreshold(String(data.ocr_confidence_threshold ?? 0.65));
    setPublishMode(data.publish_mode || "admin");
    setAiProvider(mapProvider(data.ocr_provider || data.grader_provider));
    if (!data.bot_connected) setStep(1);
    else if (!data.ai_enabled) setStep(2);
    else setStep(3);
    return data;
  }

  useEffect(() => {
    void load().catch((err) => {
      setError(err instanceof Error && err.message ? err.message : t("loadFailed"));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connectBot() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await apiPost<{ username: string; bot_connected: boolean }>(
        "/api/teacher/telegram/connect",
        token.trim() ? { token: token.trim() } : {}
      );
      setNotice(`${t("botConnected")} @${result.username}`);
      setToken("");
      setShowChangeToken(false);
      await load();
      setStep(2);
    } catch (err) {
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
      await apiPatch<OrgSettings>("/api/teacher/settings", {
        ocr_confidence_threshold: Number(threshold),
        publish_mode: publishMode,
      });
      setNotice(t("saved"));
      await load();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  const telegramDone = Boolean(settings?.bot_connected);
  const aiDone = Boolean(settings?.ai_enabled);
  const modelName =
    aiProvider === "openai"
      ? settings?.grader_model || "gpt-4o"
      : settings?.ocr_model || settings?.grader_model || "gemini-2.0-flash";

  const steps = [
    { id: 1, label: t("stepTelegram") },
    { id: 2, label: t("stepAiProvider") },
    { id: 3, label: t("stepGrading") },
  ] as const;

  return (
    <div className="space-y-4">
      {notice ? (
        <Alert>
          <AlertTitle>{t("saved")}</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <ol className="flex flex-wrap gap-2">
        {steps.map((item) => {
          const done =
            item.id === 1 ? telegramDone : item.id === 2 ? aiDone : aiDone;
          const active = step === item.id;
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setStep(item.id)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition",
                  active
                    ? "border-teal bg-teal text-teal-foreground"
                    : done
                      ? "border-border bg-card text-foreground"
                      : "border-border bg-muted/40 text-muted-foreground"
                )}
              >
                <span
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full text-xs font-semibold",
                    active
                      ? "bg-teal-foreground/15"
                      : done
                        ? "bg-[color-mix(in_oklch,var(--status-graded),white_70%)] text-[color-mix(in_oklch,var(--status-graded),black_30%)]"
                        : "bg-muted"
                  )}
                >
                  {done && !active ? (
                    <CheckIcon className="size-3" />
                  ) : (
                    item.id
                  )}
                </span>
                {item.label}
              </button>
            </li>
          );
        })}
      </ol>

      {step === 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("settingsTelegramTitle")}</CardTitle>
            <CardDescription>{t("settingsTelegramLede")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={telegramDone ? "default" : "secondary"}>
                {telegramDone ? t("botConnected") : t("botNotConnected")}
              </Badge>
              {settings?.bot_username ? (
                <span className="text-sm text-muted-foreground">
                  @{settings.bot_username}
                </span>
              ) : null}
            </div>

            {settings?.telegram_bot_token_masked && !showChangeToken ? (
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span>
                  {t("botToken")} {settings.telegram_bot_token_masked}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowChangeToken(true)}
                >
                  {t("changeToken")}
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="telegramToken">{t("botToken")}</Label>
                <Input
                  id="telegramToken"
                  type="password"
                  placeholder="123456:ABC-DEF..."
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  autoComplete="off"
                />
              </div>
            )}

            <Button onClick={() => void connectBot()} disabled={busy}>
              {busy ? t("working") : t("connectWebhook")}
            </Button>
            <p className="text-xs text-muted-foreground">
              {t("settingsConnectHint")}
            </p>
            {telegramDone ? (
              <Button variant="outline" onClick={() => setStep(2)}>
                {t("continueToAi")}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("settingsAiTitle")}</CardTitle>
            <CardDescription>{t("settingsAiLede")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={aiDone ? "default" : "secondary"}>
                {aiDone
                  ? `${t("settingsEnvReady")} · ${settings?.ocr_provider || "—"}`
                  : t("settingsEnvMissing")}
              </Badge>
            </div>

            <div className="flex flex-wrap gap-2">
              {(["gemini", "openai", "claude"] as AiProvider[]).map((p) => (
                <Button
                  key={p}
                  type="button"
                  size="sm"
                  variant={aiProvider === p ? "default" : "outline"}
                  onClick={() => setAiProvider(p)}
                >
                  {p === "gemini"
                    ? "Gemini"
                    : p === "openai"
                      ? "OpenAI"
                      : "Claude"}
                </Button>
              ))}
            </div>

            <div className="space-y-2">
              <Label htmlFor="aiKey">{t("apiKey")}</Label>
              <Input
                id="aiKey"
                type="password"
                disabled
                value=""
                placeholder={t("apiKeyFromEnv")}
              />
              <p className="text-xs text-muted-foreground">{t("aiFromEnv")}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="aiModel">{t("modelLabel")}</Label>
              <Input id="aiModel" value={modelName} readOnly />
            </div>

            <div className="grid gap-1 rounded-xl border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground">
              <p>
                OCR: <span className="font-mono text-foreground">{settings?.ocr_provider}</span>
                {" · "}
                <span className="font-mono">{settings?.ocr_model}</span>
              </p>
              <p>
                Grader:{" "}
                <span className="font-mono text-foreground">
                  {settings?.grader_provider}
                </span>
                {" · "}
                <span className="font-mono">{settings?.grader_model}</span>
              </p>
            </div>

            <Button size="lg" onClick={() => setStep(3)}>
              {t("actionContinue")}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {step === 3 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("settingsGradingTitle")}</CardTitle>
            <CardDescription>{t("settingsGradingLede")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={saveGrading}>
              <div className="space-y-2">
                <Label htmlFor="ocrThreshold">{t("ocrThreshold")}</Label>
                <Input
                  id="ocrThreshold"
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {t("settingsThresholdHint")}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t("publishMode")}</Label>
                <Select
                  value={publishMode}
                  onValueChange={(v) =>
                    setPublishMode(v as "auto" | "admin")
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">{t("publishAdmin")}</SelectItem>
                    <SelectItem value="auto">{t("publishAuto")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" disabled={busy}>
                {busy ? t("working") : t("saveSettings")}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
