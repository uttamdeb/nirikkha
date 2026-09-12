"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers";
import { LoadingBlock } from "@/components/feedback/loading-block";

export function TeacherOnly({ children }: { children: React.ReactNode }) {
  const { ready, session, isTeacher } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (ready && session && !isTeacher) router.replace("/submit");
  }, [ready, session, isTeacher, router]);

  if (!ready || !session || !isTeacher) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <LoadingBlock label="Loading…" rows={3} />
      </div>
    );
  }

  return <>{children}</>;
}
