"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { GoogleButton } from "@/components/GoogleButton";
import { useAuth } from "@/components/providers";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/api";
import { usePrefs } from "@/lib/i18n";
import { LanguagesIcon, MoonIcon, SunIcon } from "lucide-react";

type Mode = "signin" | "signup";

export default function LoginPage() {
  const { t, lang, theme, setLang, setTheme } = usePrefs();
  const { session, ready } = useAuth();
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next") || "/";

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (ready && session) router.replace(next);
  }, [ready, session, router, next]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");

    const action =
      mode === "signin"
        ? supabase.auth.signInWithPassword({ email, password })
        : supabase.auth.signUp({ email, password });

    const { data, error: authError } = await action;
    setBusy(false);

    if (authError) {
      setError(authError.message);
      return;
    }
    if (mode === "signup" && !data.session) {
      setNotice(t("confirmEmail"));
    }
  }

  async function google() {
    setError("");
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo:
          window.location.origin +
          (next.startsWith("/") ? next : "/") +
          window.location.search,
      },
    });
    if (authError) setError(authError.message);
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <section className="bg-paper relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background:
              "radial-gradient(ellipse 80% 60% at 20% 20%, oklch(0.72 0.08 195 / 0.25), transparent), radial-gradient(ellipse 70% 50% at 80% 80%, oklch(0.4 0.06 250 / 0.18), transparent)",
          }}
        />
        <div className="brand-ink-fade relative z-10 flex items-center gap-3">
          <BrandMark size="md" />
          <span className="font-heading text-sm font-semibold tracking-wide text-muted-foreground">
            {t("scriptStudio")}
          </span>
        </div>
        <div className="brand-ink-fade relative z-10 max-w-lg space-y-4">
          <h1 className="font-heading text-5xl font-semibold tracking-tight text-foreground xl:text-6xl">
            {t("brand")}
          </h1>
          <p className="text-lg text-muted-foreground">{t("tagline")}</p>
        </div>
        <p className="relative z-10 text-xs text-muted-foreground text-bangla">
          ক / খ / গ / ঘ · OCR · HITL
        </p>
      </section>

      <section className="flex flex-col justify-center px-6 py-12 sm:px-10 lg:px-16">
        <div className="mb-6 flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setLang(lang === "bn" ? "en" : "bn")}
          >
            <LanguagesIcon />
            {lang === "bn" ? "EN" : "বাং"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          >
            {theme === "light" ? <MoonIcon /> : <SunIcon />}
          </Button>
        </div>
        <div className="mx-auto w-full max-w-sm space-y-8">
          <div className="space-y-3 lg:hidden">
            <BrandMark size="md" />
            <h1 className="font-heading text-3xl font-semibold tracking-tight">
              {t("brand")}
            </h1>
            <p className="text-sm text-muted-foreground">{t("tagline")}</p>
          </div>

          <div className="space-y-1">
            <h2 className="font-heading text-2xl font-semibold tracking-tight">
              {mode === "signin" ? t("signIn") : t("createAccount")}
            </h2>
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {notice ? (
            <Alert>
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          ) : null}

          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t("email")}</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t("password")}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete={
                  mode === "signin" ? "current-password" : "new-password"
                }
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {mode === "signin" ? t("signIn") : t("createAccount")}
            </Button>
          </form>

          <div className="relative text-center text-xs text-muted-foreground">
            <span className="bg-background relative z-10 px-2">
              {t("orDivider")}
            </span>
            <div className="absolute inset-x-0 top-1/2 border-t" />
          </div>

          <GoogleButton onClick={google} disabled={busy} />

          <p className="text-center text-sm text-muted-foreground">
            {mode === "signin" ? t("noAccount") : t("haveAccount")}{" "}
            <button
              type="button"
              className="font-medium text-teal underline-offset-4 hover:underline"
              onClick={() => {
                setMode(mode === "signin" ? "signup" : "signin");
                setError("");
                setNotice("");
              }}
            >
              {mode === "signin" ? t("createOne") : t("signInInstead")}
            </button>
          </p>
        </div>
      </section>
    </div>
  );
}
