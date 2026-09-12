"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Annotation } from "@/lib/api";
import { usePrefs } from "@/lib/i18n";

/**
 * Draw a box on a page of the script and attach a note.
 *
 * Coordinates are stored as fractions of the rendered image, not pixels, so a
 * mark made on a phone lands in the same place on a laptop and survives any
 * later change to how the page is displayed.
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
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [pending, setPending] = useState<Omit<Annotation, "id" | "note"> | null>(null);
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
    // Ignore a stray click; only a real drag becomes an annotation.
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

  return (
    <div className="annotator">
      <div
        ref={frame}
        className={`annotator-frame ${editable ? "drawable" : ""}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <img src={url} alt={`${t("scriptWord")} ${page + 1}`} draggable={false} />

        {mine.map((a) => (
          <span
            key={a.id}
            className={`anno ${a.colour}`}
            style={{
              left: `${a.x0 * 100}%`,
              top: `${a.y0 * 100}%`,
              width: `${(a.x1 - a.x0) * 100}%`,
              height: `${(a.y1 - a.y0) * 100}%`,
            }}
          >
            {a.note && <span className="anno-note">{a.note}</span>}
            {editable && a.id && (
              <button
                className="anno-del"
                title={t("deleteAnnotation")}
                onClick={(e) => {
                  e.stopPropagation();
                  void onDelete(a.id!);
                }}
              >
                ×
              </button>
            )}
          </span>
        ))}

        {live && (
          <span
            className="anno red drawing"
            style={{
              left: `${Math.min(live.x0, live.x1) * 100}%`,
              top: `${Math.min(live.y0, live.y1) * 100}%`,
              width: `${Math.abs(live.x1 - live.x0) * 100}%`,
              height: `${Math.abs(live.y1 - live.y0) * 100}%`,
            }}
          />
        )}
      </div>

      {pending && (
        <div className="anno-form">
          <input
            type="text"
            value={note}
            autoFocus
            maxLength={500}
            placeholder={t("annotationNote")}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void save()}
          />
          <select
            value={pending.colour}
            onChange={(e) =>
              setPending({ ...pending, colour: e.target.value as Annotation["colour"] })
            }
          >
            <option value="red">●</option>
            <option value="amber">●</option>
            <option value="green">●</option>
          </select>
          <button className="small" disabled={busy} onClick={() => void save()}>
            {busy ? <span className="spin" /> : t("addAnnotation")}
          </button>
          <button className="ghost small" onClick={() => setPending(null)}>
            {t("cancel")}
          </button>
        </div>
      )}
    </div>
  );
}
