"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { getProfile, initApi, supabase } from "@/lib/api";
import { loadConfig } from "@/lib/config";
import { PrefsProvider } from "@/lib/i18n";
import { LoadingBlock } from "@/components/feedback/loading-block";

type AuthState = {
  session: Session | null;
  role: string;
  ready: boolean;
  isTeacher: boolean;
  refreshRole: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

function AuthInner({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState("student");
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const config = await loadConfig();
        initApi(config);
        const { data } = await supabase.auth.getSession();
        if (!active) return;
        setSession(data.session);
        setReady(true);
      } catch (err) {
        if (!active) return;
        setBootError(err instanceof Error ? err.message : String(err));
        setReady(true);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!ready || bootError) return;
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => sub.subscription.unsubscribe();
  }, [ready, bootError]);

  const refreshRole = useCallback(async () => {
    if (!session) {
      setRole("student");
      return;
    }
    const { role: next } = await getProfile(session);
    setRole(next);
  }, [session]);

  useEffect(() => {
    void refreshRole();
  }, [refreshRole]);

  const value = useMemo<AuthState>(
    () => ({
      session,
      role,
      ready,
      isTeacher: role === "teacher",
      refreshRole,
    }),
    [session, role, ready, refreshRole]
  );

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <LoadingBlock label="Loading…" />
      </div>
    );
  }

  if (bootError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-destructive">{bootError}</p>
        <button
          type="button"
          className="text-sm text-teal underline"
          onClick={() => window.location.reload()}
        >
          Retry
        </button>
      </div>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <PrefsProvider>
      <AuthInner>{children}</AuthInner>
    </PrefsProvider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside Providers");
  return ctx;
}
