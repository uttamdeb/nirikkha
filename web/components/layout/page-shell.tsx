import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { DashboardHeader } from "@/components/dashboard-header";

interface PageShellProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  breadcrumbs?: { label: string; href?: string }[];
}

export function PageShell({
  title,
  description,
  actions,
  children,
  className,
  breadcrumbs,
}: PageShellProps) {
  return (
    <>
      <DashboardHeader title={title} breadcrumbs={breadcrumbs} />
      <div
        className={cn(
          "flex flex-1 flex-col gap-6 p-4 pt-0 md:p-6 md:pt-0",
          className
        )}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
              {title}
            </h1>
            {description ? (
              <p className="max-w-2xl text-sm text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          ) : null}
        </div>
        {children}
      </div>
    </>
  );
}
