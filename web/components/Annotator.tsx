"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Annotation } from "@/lib/api";
import { usePrefs } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Draw a box on a page of the script and attach a note.
 * Coordinates are fractions of the rendered image.
 */
export default function Annotator({
  url,
  page,
  annotations,
  editable,
  onAdd,
  onDelete,
}: {
  url: string;
  page: number;
  annotations: Annotation[];
  editable: boolean;
  onAdd: (a: Omit<Annotation, "id">) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const { t } = usePrefs();
  const frame = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);
  const [pending, setPending] = useState<Omit<Annotation, "id" | "note"> | null>(
    null
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const mine = annotations.filter((a) => a.page === page);

  function relative(event: ReactPointerEvent) {
    const box = frame.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
    };
  }

  function down(event: ReactPointerEvent) {
    if (!editable || pending) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const { x, y } = relative(event);
    setDrag({ x0: x, y0: y, x1: x, y1: y });
  }

  function move(event: ReactPointerEvent) {
    if (!drag) return;
    const { x, y } = relative(event);
    setDrag((d) => (d ? { ...d, x1: x, y1: y } : d));
  }

  function up() {
    if (!drag) return;
    const box = {
      x0: Math.min(drag.x0, drag.x1),
      y0: Math.min(drag.y0, drag.y1),
      x1: Math.max(drag.x0, drag.x1),
      y1: Math.max(drag.y0, drag.y1),
    };
    setDrag(null);
    if (box.x1 - box.x0 < 0.01 || box.y1 - box.y0 < 0.01) return;
    setPending({ page, colour: "red", ...box });
    setNote("");
  }

  async function save() {
    if (!pending) return;
    setBusy(true);
    try {
      await onAdd({ ...pending, note: note.trim() || null });
      setPending(null);
      setNote("");
    } finally {
      setBusy(false);
    }
  }

  const live = drag ?? (pending ? { ...pending } : null);

  const colourBorder: Record<Annotation["colour"], string> = {
    red: "border-destructive bg-destructive/10",
    amber:
      "border-[color-mix(in_oklch,var(--status-review),black_10%)] bg-[color-mix(in_oklch,var(--status-review),white_85%)]",
    green:
      "border-[color-mix(in_oklch,var(--status-graded),black_10%)] bg-[color-mix(in_oklch,var(--status-graded),white_85%)]",
  };

  return (
    <div className="space-y-3">
      <div
        ref={frame}
        className={cn(
          "bg-paper relative inline-block min-h-[140px] min-w-[220px] max-w-full leading-none",
          editable && "cursor-crosshair touch-none"
        )}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={`${t("scriptWord")} ${page + 1}`}
          draggable={false}
          className="block max-w-full min-w-[220px] rounded-lg border border-border object-contain"
        />

        {mine.map((a) => (
          <span
            key={a.id}
            className={cn(
              "pointer-events-none absolute rounded-sm border-2",
              colourBorder[a.colour]
            )}
            style={{
              left: `${a.x0 * 100}%`,
              top: `${a.y0 * 100}%`,
              width: `${(a.x1 - a.x0) * 100}%`,
              height: `${(a.y1 - a.y0) * 100}%`,
            }}
          >
            {a.note ? (
              <span className="absolute -top-2 left-1 max-w-[230px] -translate-y-full rounded-md bg-foreground px-1.5 py-0.5 text-[11.5px] leading-snug whitespace-normal text-background">
                {a.note}
              </span>
            ) : null}
            {editable && a.id ? (
              <button
                type="button"
                title={t("deleteAnnotation")}
                className="pointer-events-auto absolute -top-2 -right-2 grid size-[19px] place-items-center rounded-full border-0 bg-destructive text-xs text-white"
                onClick={(e) => {
                  e.stopPropagation();
                  void onDelete(a.id!);
                }}
              >
                ×
              </button>
            ) : null}
          </span>
        ))}

        {live ? (
          <span
            className="pointer-events-none absolute rounded-sm border-2 border-dashed border-destructive bg-destructive/10"
            style={{
              left: `${Math.min(live.x0, live.x1) * 100}%`,
              top: `${Math.min(live.y0, live.y1) * 100}%`,
              width: `${Math.abs(live.x1 - live.x0) * 100}%`,
              height: `${Math.abs(live.y1 - live.y0) * 100}%`,
            }}
          />
        ) : null}
      </div>

      {pending ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={note}
            autoFocus
            maxLength={500}
            placeholder={t("annotationNote")}
            className="min-w-[160px] flex-1"
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void save()}
          />
          <Select
            value={pending.colour}
            onValueChange={(v) =>
              setPending({
                ...pending,
                colour: v as Annotation["colour"],
              })
            }
          >
            <SelectTrigger className="w-[72px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="red">●</SelectItem>
              <SelectItem value="amber">●</SelectItem>
              <SelectItem value="green">●</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" disabled={busy} onClick={() => void save()}>
            {t("addAnnotation")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
            {t("cancel")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
