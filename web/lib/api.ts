import { createClient, type SupabaseClient, type Session } from "@supabase/supabase-js";
import type { ClientConfig } from "./config";

// Created once by initApi() before the app renders, so nothing imports a
// half-configured client at module load — the failure mode that renders a
// blank page with no explanation.
let client: SupabaseClient | null = null;
export let API_BASE = "";

export function initApi(config: ClientConfig): void {
  API_BASE = config.apiBase;
  client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    if (!client) throw new Error("initApi() must run before the Supabase client is used");
    return Reflect.get(client, prop, client);
  },
});

export type PartKey = "ka" | "kha" | "ga" | "gha";

export type Line = {
  index: number;
  text: string;
  legibility: number | null;
  is_guess: boolean;
  bbox: { x0: number; y0: number; x1: number; y1: number } | null;
  clarified_text: string | null;
  needs_clarification: boolean;
};

export type Annotation = {
  id?: string | null;
  page: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  note: string | null;
  colour: "red" | "amber" | "green";
};

export type StudentBrief = { id: string; email: string | null; full_name: string | null };

/** How a person is named in the interface. */
export function personName(p: StudentBrief | null | undefined): string {
  if (!p) return "";
  return p.full_name || (p.email ?? "").split("@")[0] || "—";
}

export type PanelRow = {
  id: string;
  status: Submission["status"];
  subject: string | null;
  question_text: string;
  total_awarded: number | null;
  total_max: number;
  needs_human_review: boolean;
  review_reason: string | null;
  marks_stale: boolean;
  created_at: string | null;
  released_at: string | null;
  student: StudentBrief | null;
  pages: number;
};

export type PanelPage = {
  rows: PanelRow[];
  total: number;
  matched: number;
  offset: number;
  counts: Record<string, number>;
  flagged: number;
};

export type PartStat = {
  bangla: string;
  skill: string;
  max_marks: number;
  marked: number;
  accuracy: number | null;
  average: number | null;
};

export type TeacherStats = {
  submissions: number;
  scored: number;
  average: number | null;
  highest: number | null;
  lowest: number | null;
  override_rate: number | null;
  overridden_marks: number;
  per_part: Record<string, PartStat>;
};

export type Mark = {
  part: PartKey;
  bangla: string;
  skill: string;
  max_marks: number;
  awarded: number;
  ai_awarded: number | null;
  reason: string;
  improvement: string;
  ai_reason: string;
  ai_improvement: string;
  edited_by: StudentBrief | null;
  edited_at: string | null;
  evidence_lines: number[];
};

export type Submission = {
  id: string;
  status:
    | "received"
    | "ocr_running"
    | "awaiting_student"
    | "grading"
    | "awaiting_teacher"
    | "released"
    | "failed";
  question_text: string;
  subject: string | null;
  image_url: string | null;
  image_urls: string[];
  needs_human_review: boolean;
  review_reason: string | null;
  total_awarded: number | null;
  total_max: number;
  feedback: string | null;
  ocr_engine: string | null;
  grader_model: string | null;
  error: string | null;
  created_at: string | null;
  released_at: string | null;
  teacher_feedback: string | null;
  ai_feedback: string | null;
  feedback_edited_by: StudentBrief | null;
  reviewed_by: StudentBrief | null;
  marks_stale: boolean;
  reviewed_at: string | null;
  student: StudentBrief | null;
  lines: Line[];
  marks: Mark[];
  annotations: Annotation[];
};

export type SubmissionSummary = Pick<
  Submission,
  | "id"
  | "status"
  | "subject"
  | "question_text"
  | "total_awarded"
  | "total_max"
  | "needs_human_review"
  | "review_reason"
  | "created_at"
>;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError("You are signed out. Sign in again to continue.", 401);
  return { Authorization: `Bearer ${token}` };
}

async function unwrap<T>(response: Response): Promise<T> {
  if (response.ok) {
    return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
  }
  let detail = `Request failed (${response.status})`;
  try {
    const body = await response.json();
    const raw = body.detail ?? body.message;
    if (typeof raw === "string") detail = raw;
    else if (Array.isArray(raw) && raw[0]?.msg) detail = String(raw[0].msg);
  } catch {
    /* keep the status-based message */
  }
  throw new ApiError(detail, response.status);
}

export async function apiGet<T>(path: string): Promise<T> {
  return unwrap<T>(await fetch(`${API_BASE}${path}`, { headers: await authHeader() }));
}

export async function apiDelete(path: string): Promise<void> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    headers: await authHeader(),
  });
  if (!response.ok && response.status !== 204) {
    throw new ApiError(`Request failed (${response.status})`, response.status);
  }
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const headers = { ...(await authHeader()), "Content-Type": "application/json" };
  return unwrap<T>(
    await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  const headers = { ...(await authHeader()), "Content-Type": "application/json" };
  return unwrap<T>(
    await fetch(`${API_BASE}${path}`, {
      method: "PATCH",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  const headers = { ...(await authHeader()), "Content-Type": "application/json" };
  return unwrap<T>(
    await fetch(`${API_BASE}${path}`, {
      method: "PUT",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

export const MAX_PAGES = 3;

export async function createSubmission(
  questionText: string,
  subject: string,
  files: File[],
): Promise<{ id: string; pages: number }> {
  const form = new FormData();
  form.append("question_text", questionText);
  if (subject) form.append("subject", subject);
  // Repeated field name, which is how FastAPI receives a list[UploadFile].
  for (const file of files) form.append("script", file);
  return unwrap(
    await fetch(`${API_BASE}/api/submissions`, {
      method: "POST",
      headers: await authHeader(),
      body: form,
    }),
  );
}

export async function getProfile(session: Session): Promise<{ role: string }> {
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .maybeSingle();
  if (error) return { role: "student" };
  return { role: data?.role ?? "student" };
}

/** Marks the unreadable spans the model flagged, so the UI can point at them. */
export const UNCLEAR_TOKEN = "[[অস্পষ্ট]]";
export const UNCLEAR_LINE = "[[অস্পষ্ট লাইন]]";

export function splitUnclear(text: string): { text: string; unclear: boolean }[] {
  const parts: { text: string; unclear: boolean }[] = [];
  const pattern = /\[\[\s*অস্পষ্ট(?:\s*লাইন)?\s*\]\]/g;
  let cursor = 0;
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    if (m.index > cursor) parts.push({ text: text.slice(cursor, m.index), unclear: false });
    parts.push({ text: m[0].includes("লাইন") ? "···" : "?", unclear: true });
    cursor = m.index + m[0].length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), unclear: false });
  return parts.length ? parts : [{ text, unclear: false }];
}

export const STATUS_LABEL: Record<Submission["status"], string> = {
  received: "জমা হয়েছে",
  ocr_running: "পড়া হচ্ছে",
  awaiting_student: "তোমার সাহায্য দরকার",
  grading: "মূল্যায়ন চলছে",
  awaiting_teacher: "শিক্ষকের অপেক্ষায়",
  released: "ফলাফল প্রকাশিত",
  failed: "পড়া যায়নি",
};
