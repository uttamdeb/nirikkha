"use client";

import { useEffect, useState, type FormEvent } from "react";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  const [step, setStep] = useState<1 | 2 | 3>(1);
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
        if (data.bot_connected) setStep(2);
        if (data.bot_connected && data.ai_from_env) setStep(3);
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
      setStep(data.ai_from_env ? 3 : 2);
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

  const steps = [
    { id: 1 as const, label: t("stepTelegram") },
    { id: 2 as const, label: t("stepAi") },
    { id: 3 as const, label: t("stepGrading") },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {steps.map((item) => {
          const isActive = step === item.id;
          const isDone =
            item.id === 1
              ? Boolean(settings?.bot_connected)
              : item.id === 2
                ? Boolean(settings?.ai_from_env)
                : false;

          return (
            <Button
              key={item.id}
              type="button"
              size="sm"
              variant={isActive ? "default" : "outline"}
              className="rounded-full"
              onClick={() => setStep(item.id)}
            >
              {item.id}. {item.label}
              {isDone ? ` · ${t("saved")}` : ""}
            </Button>
          );
        })}
      </div>

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

      {step === 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("settingsTelegramTitle")}</CardTitle>
            <CardDescription>{t("settingsTelegramLede")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={settings?.bot_connected ? "default" : "secondary"}>
                {settings?.bot_connected ? t("botConnected") : t("botNotConnected")}
              </Badge>
              {settings?.bot_username ? (
                <Badge variant="outline">@{settings.bot_username}</Badge>
              ) : null}
            </div>

            <form className="space-y-4" onSubmit={connect}>
              <div className="space-y-2">
                <Label htmlFor="telegram-token">{t("botToken")}</Label>
                <Input
                  id="telegram-token"
                  type="password"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder={settings?.telegram_bot_token_masked || "123456:ABC..."}
                  autoComplete="off"
                />
              </div>

              <p className="text-xs text-muted-foreground">{t("botTokenHint")}</p>
              <p className="text-xs text-muted-foreground">{t("settingsConnectHint")}</p>

              <div className="flex flex-wrap gap-2">
                <Button disabled={busy} type="submit">
                  {t("connectWebhook")}
                </Button>
                {settings?.bot_connected ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStep(2)}
                  >
                    {t("actionContinue")}
                  </Button>
                ) : null}
              </div>
            </form>
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
              <Badge variant={settings?.ai_from_env ? "default" : "secondary"}>
                {settings?.ai_from_env ? t("settingsEnvReady") : t("settingsEnvMissing")}
              </Badge>
            </div>

            <Alert>
              <AlertDescription>{t("aiFromEnv")}</AlertDescription>
            </Alert>

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => setStep(1)}>
                {t("back")}
              </Button>
              <Button type="button" onClick={() => setStep(3)}>
                {t("actionContinue")}
              </Button>
            </div>
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
                <Label htmlFor="ocr-threshold">{t("ocrThreshold")}</Label>
                <Input
                  id="ocr-threshold"
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={threshold}
                  onChange={(event) => setThreshold(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t("settingsThresholdHint")}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="publish-mode">{t("publishMode")}</Label>
                <Select
                  value={publishMode}
                  onValueChange={(value) => setPublishMode(value as "auto" | "admin")}
                >
                  <SelectTrigger id="publish-mode" className="w-full rounded-lg bg-card">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">{t("publishAdmin")}</SelectItem>
                    <SelectItem value="auto">{t("publishAuto")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => setStep(2)}>
                  {t("back")}
                </Button>
                <Button disabled={busy} type="submit">
                  {t("saveSettings")}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
