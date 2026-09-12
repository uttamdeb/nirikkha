import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface LoadingBlockProps {
  rows?: number;
  className?: string;
  label?: string;
}

export function LoadingBlock({ rows = 4, className, label }: LoadingBlockProps) {
  return (
    <div className={cn("w-full max-w-md space-y-3", className)}>
      {label ? (
        <p className="text-center text-sm text-muted-foreground">{label}</p>
      ) : null}
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-12 w-full rounded-lg" />
      ))}
    </div>
  );
}
