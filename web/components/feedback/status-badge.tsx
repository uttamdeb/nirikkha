import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  needs_review:
    "border-transparent bg-[color-mix(in_oklch,var(--status-review),white_75%)] text-[color-mix(in_oklch,var(--status-review),black_35%)]",
  graded:
    "border-transparent bg-[color-mix(in_oklch,var(--status-graded),white_78%)] text-[color-mix(in_oklch,var(--status-graded),black_30%)]",
  published:
    "border-transparent bg-[color-mix(in_oklch,var(--teal),white_78%)] text-[color-mix(in_oklch,var(--teal),black_30%)]",
  processing: "border-transparent bg-secondary text-secondary-foreground",
  received: "border-transparent bg-muted text-muted-foreground",
  failed:
    "border-transparent bg-[color-mix(in_oklch,var(--status-failed),white_78%)] text-[color-mix(in_oklch,var(--status-failed),black_25%)]",
  clarifying: "border-transparent bg-accent text-accent-foreground",
  draft: "border-transparent bg-muted text-muted-foreground",
  closed:
    "border-transparent bg-[color-mix(in_oklch,var(--foreground),white_88%)] text-muted-foreground",
  approved: "border-transparent bg-secondary text-secondary-foreground",
  // Submission pipeline
  ocr_running: "border-transparent bg-secondary text-secondary-foreground",
  awaiting_student:
    "border-transparent bg-[color-mix(in_oklch,var(--status-review),white_75%)] text-[color-mix(in_oklch,var(--status-review),black_35%)]",
  grading: "border-transparent bg-secondary text-secondary-foreground",
  awaiting_teacher:
    "border-transparent bg-[color-mix(in_oklch,var(--status-review),white_75%)] text-[color-mix(in_oklch,var(--status-review),black_35%)]",
  released:
    "border-transparent bg-[color-mix(in_oklch,var(--status-graded),white_78%)] text-[color-mix(in_oklch,var(--status-graded),black_30%)]",
};

const LABELS: Record<string, string> = {
  needs_review: "Needs review",
  graded: "Graded",
  published: "Published",
  processing: "Processing",
  received: "Received",
  failed: "Failed",
  clarifying: "Clarifying",
  draft: "Draft",
  closed: "Closed",
  approved: "Approved",
};

interface StatusBadgeProps {
  status: string;
  className?: string;
  label?: string;
}

export function StatusBadge({ status, className, label }: StatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(STATUS_STYLES[status] ?? STATUS_STYLES.draft, className)}
    >
      {label ?? LABELS[status] ?? status}
    </Badge>
  );
}
