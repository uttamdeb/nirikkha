"use client";

import { cn } from "@/lib/utils";
import { usePrefs } from "@/lib/i18n";

interface BrandMarkProps {
  className?: string;
  size?: "sm" | "md" | "lg";
}

const SIZES = {
  sm: "size-8",
  md: "size-10",
  lg: "size-14",
};

export function BrandMark({ className, size = "md" }: BrandMarkProps) {
  const { theme } = usePrefs();
  const src = theme === "dark" ? "/logo-dark.png" : "/logo.png";

  return (
    <div
      className={cn(
        "flex items-center justify-center overflow-hidden rounded-xl bg-sidebar-primary shadow-sm brand-ink-fade",
        SIZES[size],
        className
      )}
      aria-hidden
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="size-full object-cover" />
    </div>
  );
}
