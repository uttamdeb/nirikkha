/** Same-origin path only — blocks open redirects to production after OAuth. */
export function safeNextPath(raw: string | null | undefined, fallback = "/"): string {
  if (!raw) return fallback;
  // Absolute URLs and protocol-relative //evil.com must not win.
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  return raw;
}

const NEXT_KEY = "nirikkha.auth.next";

export function rememberAuthNext(path: string): void {
  try {
    sessionStorage.setItem(NEXT_KEY, safeNextPath(path));
  } catch {
    /* private mode */
  }
}

export function takeAuthNext(fallback = "/"): string {
  try {
    const stored = sessionStorage.getItem(NEXT_KEY);
    if (stored) {
      sessionStorage.removeItem(NEXT_KEY);
      return safeNextPath(stored, fallback);
    }
  } catch {
    /* private mode */
  }
  return safeNextPath(fallback, "/");
}

/** OAuth must return to this exact path so Supabase allowlist stays stable. */
export function oauthRedirectTo(origin: string = window.location.origin): string {
  return `${origin.replace(/\/$/, "")}/login`;
}
