import { useState, type FormEvent } from "react";
import { supabase } from "../lib/api";
import { usePrefs } from "../lib/i18n";
import Toggles from "../components/Toggles";
import GoogleButton from "../components/GoogleButton";

type Mode = "signin" | "signup";

export default function AuthPage() {
  const { t } = usePrefs();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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
    // Sign-up with email confirmation on returns a user but no session.
    if (mode === "signup" && !data.session) {
      setNotice(t("confirmEmail"));
    }
  }

  async function google() {
    setError("");
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      // Back to the page they were on, not the front page: an OAuth consent
      // link carries an authorization_id in the query that must survive.
      options: {
        redirectTo: window.location.origin + window.location.pathname + window.location.search,
      },
    });
    if (authError) setError(authError.message);
  }

  return (
    <div className="center">
      <div className="card auth-card">
        <div className="row" style={{ marginBottom: 14 }}>
          <div className="spacer" />
          <Toggles />
        </div>
        <h1>
          {t("brand")}<span style={{ color: "var(--green)" }}>.</span>
        </h1>
        <p className="lede" style={{ fontSize: "1.06rem", color: "var(--green-deep)" }}>
          {t("tagline")}
        </p>

        {error && <div className="banner err">{error}</div>}
        {notice && <div className="banner ok">{notice}</div>}

        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">{t("email")}</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="field">
            <label htmlFor="password">{t("password")}</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
            />
          </div>
          <button type="submit" disabled={busy} style={{ width: "100%" }}>
            {busy ? <span className="spin" /> : mode === "signin" ? t("signIn") : t("createAccount")}
          </button>
        </form>

        <div className="divider">{t("orDivider")}</div>

        <GoogleButton onClick={google} disabled={busy} />

        <p className="muted" style={{ marginTop: 18, marginBottom: 0, textAlign: "center" }}>
          {mode === "signin" ? t("noAccount") : t("haveAccount")}{" "}
          <button
            className="link"
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
    </div>
  );
}
