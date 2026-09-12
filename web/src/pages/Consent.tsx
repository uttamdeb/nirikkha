import { useEffect, useState } from "react";
import { supabase } from "../lib/api";
import { usePrefs } from "../lib/i18n";

/**
 * OAuth consent screen.
 *
 * Supabase Auth is the authorization server for the MCP endpoint, and it hands
 * the decision back to us: when a client asks for access it sends the signed-in
 * user here with an authorization_id, and nothing is granted until this page
 * approves it. So this is the only place a person can see which client is
 * asking, and the only place they can refuse.
 */

type Details = {
  authorization_id: string;
  redirect_uri: string;
  client: { name?: string; client_name?: string; client_uri?: string; logo_uri?: string };
  user: { id: string; email: string };
  scope: string;
};

export default function ConsentPage() {
  const { t } = usePrefs();
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);

  const authorizationId = new URLSearchParams(window.location.search).get("authorization_id");

  useEffect(() => {
    if (!authorizationId) {
      setError(t("consentNoRequest"));
      return;
    }
    let active = true;
    supabase.auth.oauth
      .getAuthorizationDetails(authorizationId)
      .then(({ data, error: err }) => {
        if (!active) return;
        if (err || !data) {
          setError(err?.message || t("consentFailed"));
          return;
        }
        // Already consented once: Supabase returns the redirect straight away
        // and there is nothing left to ask.
        if (!("authorization_id" in data)) {
          window.location.href = data.redirect_url;
          return;
        }
        setDetails(data as Details);
      })
      .catch((err: unknown) => active && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      active = false;
    };
  }, [authorizationId, t]);

  async function decide(approve: boolean) {
    if (!authorizationId) return;
    setBusy(approve ? "approve" : "deny");
    setError("");
    try {
      const call = approve
        ? supabase.auth.oauth.approveAuthorization
        : supabase.auth.oauth.denyAuthorization;
      // skipBrowserRedirect so a failure surfaces here instead of navigating
      // away mid-error.
      const { data, error: err } = await call.call(supabase.auth.oauth, authorizationId, {
        skipBrowserRedirect: true,
      });
      if (err || !data?.redirect_url) throw new Error(err?.message || t("consentFailed"));
      window.location.href = data.redirect_url;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  }

  if (error && !details) {
    return (
      <>
        <h1>{t("consentTitle")}</h1>
        <div className="banner err">{error}</div>
      </>
    );
  }

  if (!details) {
    return (
      <div className="center">
        <span className="spin" />
      </div>
    );
  }

  const client = details.client.client_name || details.client.name || t("consentUnnamedClient");
  const scopes = details.scope.split(/\s+/).filter(Boolean);

  return (
    <>
      <h1>{t("consentTitle")}</h1>
      <p className="lede">{t("consentLede", { client })}</p>

      {error && <div className="banner err">{error}</div>}

      <div className="card">
        <div className="stat-row">
          <div className="stat">
            <span className="k">{t("consentClient")}</span>
            <span className="v" style={{ fontSize: 17 }}>{client}</span>
          </div>
          <div className="stat">
            <span className="k">{t("consentAccount")}</span>
            <span className="v" style={{ fontSize: 17 }}>{details.user.email}</span>
          </div>
        </div>

        <h3 style={{ marginTop: 18 }}>{t("consentGrants")}</h3>
        <ul className="plain">
          <li>{t("consentGrantSubmit")}</li>
          <li>{t("consentGrantRead")}</li>
        </ul>
        {scopes.length > 0 && (
          <p className="muted" style={{ fontSize: 12.5 }}>
            {t("consentScopes")}: <code>{scopes.join(" ")}</code>
          </p>
        )}
        <p className="muted" style={{ fontSize: 12.5 }}>
          {t("consentRedirect")}: <code>{details.redirect_uri}</code>
        </p>
      </div>

      <div className="row" style={{ marginTop: 16, gap: 10 }}>
        <button disabled={busy !== null} onClick={() => void decide(true)}>
          {busy === "approve" ? <span className="spin" /> : t("consentApprove")}
        </button>
        <button className="ghost" disabled={busy !== null} onClick={() => void decide(false)}>
          {busy === "deny" ? <span className="spin" /> : t("consentDeny")}
        </button>
      </div>
    </>
  );
}
