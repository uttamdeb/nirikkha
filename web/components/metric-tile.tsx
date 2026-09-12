"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function MetricTile({
  label,
  value,
  hint,
  icon,
  tone = "default",
}: {
  label: string;
  value: number | string;
  hint: string;
  icon: ReactNode;
  tone?: "default" | "amber";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-4",
        tone === "amber"
          ? "border-[color-mix(in_oklch,var(--status-review),white_45%)] bg-[color-mix(in_oklch,var(--status-review),white_92%)]"
          : "border-border/70 bg-card"
      )}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </span>
        <span className="rounded-lg bg-muted/80 p-1.5 text-muted-foreground">
          {icon}
        </span>
      </div>
      <p className="font-heading text-3xl font-semibold tracking-tight tabular-nums">
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
