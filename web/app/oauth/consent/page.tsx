"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import ConsentPage from "@/components/pages/Consent";
import { useAuth } from "@/components/providers";
import { LoadingBlock } from "@/components/feedback/loading-block";

export default function ConsentRoute() {
  const { session, ready } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (ready && !session) {
      const q =
        typeof window !== "undefined" ? window.location.search : "";
      router.replace(`/login?next=${encodeURIComponent(pathname + q)}`);
    }
  }, [ready, session, router, pathname]);

  if (!ready || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <LoadingBlock label="Loading…" />
      </div>
    );
  }

  return (
    <div className="bg-paper flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
        <ConsentPage />
      </div>
    </div>
  );
}
