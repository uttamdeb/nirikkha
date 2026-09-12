"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { usePrefs } from "@/lib/i18n";

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
  const [authorizationId, setAuthorizationId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    setAuthorizationId(new URLSearchParams(window.location.search).get("authorization_id"));
  }, []);

  useEffect(() => {
    if (!authorizationId) {
      if (authorizationId === undefined) return;
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
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!details) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("consentTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t("working")}</p>
        </CardContent>
      </Card>
    );
  }

  const client = details.client.client_name || details.client.name || t("consentUnnamedClient");
  const scopes = details.scope.split(/\s+/).filter(Boolean);

  return (
    <Card className="shadow-none ring-0">
      <CardHeader>
        <CardTitle>{t("consentTitle")}</CardTitle>
        <CardDescription>{t("consentLede", { client })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-4">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t("consentClient")}</p>
            <p className="font-medium">{client}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t("consentAccount")}</p>
            <p className="font-medium">{details.user.email}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t("consentGrants")}</p>
            <p className="text-sm">{t("consentGrantSubmit")}</p>
            <p className="text-sm">{t("consentGrantRead")}</p>
          </div>
          {scopes.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("consentScopes")}: <code>{scopes.join(" ")}</code>
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {t("consentRedirect")}: <code>{details.redirect_uri}</code>
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button disabled={busy !== null} onClick={() => void decide(true)}>
            {busy === "approve" ? t("working") : t("consentApprove")}
          </Button>
          <Button
            variant="outline"
            disabled={busy !== null}
            onClick={() => void decide(false)}
          >
            {busy === "deny" ? t("working") : t("consentDeny")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
