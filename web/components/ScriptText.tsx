"use client";

import katex from "katex";
import { useMemo } from "react";

/**
 * Renders a line of a transcribed script.
 *
 * Two things can appear inside it and both have to survive:
 *
 *   $…$        mathematics, because a CQ answer in physics or chemistry is
 *              mostly working, and the reader is asked to transcribe it as
 *              KaTeX. Left unrendered it reads as `$\rightarrow$`, which is
 *              worse than useless to a student.
 *   [[অস্পষ্ট]] a word the reader could not make out. Shown as a marker the
 *              teacher can see at a glance rather than silently dropped.
 */

const UNCLEAR = /\[\[\s*অস্পষ্ট(?:\s*লাইন)?\s*\]\]/g;
// $$block$$ first, then $inline$. The negative lookahead keeps a lone currency
// symbol from starting a maths span that never closes.
const MATH = /\$\$([^$]+?)\$\$|\$([^$\n]+?)\$/g;

type Piece =
  | { kind: "text"; value: string }
  | { kind: "unclear"; whole: boolean }
  | { kind: "math"; value: string; display: boolean };

function parse(source: string): Piece[] {
  const pieces: Piece[] = [];

  // Split on the unclear markers first so a marker inside maths cannot confuse
  // the maths parser, then look for maths within each plain run.
  let cursor = 0;
  UNCLEAR.lastIndex = 0;
  for (let m = UNCLEAR.exec(source); m; m = UNCLEAR.exec(source)) {
    if (m.index > cursor) pushText(source.slice(cursor, m.index));
    pieces.push({ kind: "unclear", whole: m[0].includes("লাইন") });
    cursor = m.index + m[0].length;
  }
  if (cursor < source.length) pushText(source.slice(cursor));
  return pieces;

  function pushText(run: string) {
    let at = 0;
    MATH.lastIndex = 0;
    for (let m = MATH.exec(run); m; m = MATH.exec(run)) {
      if (m.index > at) pieces.push({ kind: "text", value: run.slice(at, m.index) });
      pieces.push({ kind: "math", value: m[1] ?? m[2] ?? "", display: Boolean(m[1]) });
      at = m.index + m[0].length;
    }
    if (at < run.length) pieces.push({ kind: "text", value: run.slice(at) });
  }
}

function Math({ value, display }: { value: string; display: boolean }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(value, { displayMode: display, throwOnError: false });
    } catch {
      return null;
    }
  }, [value, display]);

  // A student's working is not guaranteed to be valid LaTeX. If it will not
  // compile, show the source rather than an error or an empty gap.
  if (!html) return <code>{value}</code>;
  return <span className="math" dangerouslySetInnerHTML={{ __html: html }} />;
}

export default function ScriptText({ text }: { text: string }) {
  const pieces = useMemo(() => parse(text ?? ""), [text]);
  return (
    <>
      {pieces.map((piece, i) => {
        if (piece.kind === "unclear") {
          return (
            <span key={i} className="unclear">
              {piece.whole ? "···" : "?"}
            </span>
          );
        }
        if (piece.kind === "math") {
          return <Math key={i} value={piece.value} display={piece.display} />;
        }
        return <span key={i}>{piece.value}</span>;
      })}
    </>
  );
}
