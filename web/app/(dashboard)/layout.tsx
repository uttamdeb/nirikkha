"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { useAuth } from "@/components/providers";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { LoadingBlock } from "@/components/feedback/loading-block";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { session, ready } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (ready && !session) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
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
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  );
}
