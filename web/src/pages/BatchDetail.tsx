import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, apiGet, apiPatch, apiPost, apiPut } from "../lib/api";
import { usePrefs } from "../lib/i18n";

type Member = {
  id: string;
  display_name: string;
  student_number: number | null;
  is_group_admin: boolean;
  telegram_user_id: string;
};

type BatchDetail = {
  id: string;
  name: string;
  telegram_group: { title: string } | null;
  members: Member[];
  exams: { id: string; title: string; status: string; exam_code: string | null }[];
};

export default function BatchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = usePrefs();
  const [batch, setBatch] = useState<BatchDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});

  async function load() {
    if (!id) return;
    try {
      const data = await apiGet<{ batch: BatchDetail }>(`/api/teacher/batches/${id}`);
      setBatch(data.batch);
      const next: Record<string, string> = {};
      for (const m of data.batch.members) {
        next[m.id] = m.student_number == null ? "" : String(m.student_number);
      }
      setEdits(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("loadFailed"));
    }
  }

  useEffect(() => {
    void load();
  }, [id]);

  async function sync(postEnroll: boolean) {
    if (!id) return;
    setBusy(true);
    setError("");
    try {
      await apiPost(`/api/teacher/batches/${id}/sync-members`, { post_enroll: postEnroll });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function postRegister() {
    if (!id) return;
    setBusy(true);
    setError("");
    try {
      await apiPut(`/api/teacher/batches/${id}/sync-members`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function saveNumber(memberId: string) {
    if (!id) return;
    const raw = edits[memberId];
    const student_number = raw.trim() === "" ? null : Number(raw);
    try {
      await apiPatch(`/api/teacher/batches/${id}/members/${memberId}`, { student_number });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("saveFailed"));
    }
  }

  if (!batch) {
    return (
      <div className="stack">
        <Link to="/batches">{t("back")}</Link>
        {error ? <p className="error">{error}</p> : <span className="spin" />}
      </div>
    );
  }

  return (
    <div className="stack">
      <Link to="/batches">{t("back")}</Link>
      <div>
        <h1>{batch.name}</h1>
        <p className="muted">{batch.telegram_group?.title || t("noGroup")}</p>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button className="primary small" disabled={busy} onClick={() => void sync(true)}>
          {t("syncMembers")}
        </button>
        <button className="ghost small" disabled={busy} onClick={() => void postRegister()}>
          {t("postRegister")}
        </button>
      </div>

      <section className="card stack">
        <h2>{t("members")}</h2>
        {batch.members.map((m) => (
          <div key={m.id} className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <div style={{ minWidth: 160 }}>
              <strong>{m.display_name}</strong>
              {m.is_group_admin && <span className="pill" style={{ marginInlineStart: 6 }}>admin</span>}
              <div className="muted" style={{ fontSize: 12 }}>{m.telegram_user_id}</div>
            </div>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {t("studentNumber")}
              <input
                style={{ width: 72 }}
                value={edits[m.id] ?? ""}
                onChange={(e) => setEdits((prev) => ({ ...prev, [m.id]: e.target.value }))}
                disabled={m.is_group_admin}
              />
            </label>
            {!m.is_group_admin && (
              <button className="ghost small" type="button" onClick={() => void saveNumber(m.id)}>
                {t("saveLine")}
              </button>
            )}
          </div>
        ))}
      </section>

      {batch.exams.length > 0 && (
        <section className="card stack">
          <h2>{t("examsTitle")}</h2>
          {batch.exams.map((exam) => (
            <Link key={exam.id} to={`/exams/${exam.id}`}>
              {exam.title} · {exam.exam_code || "—"} · {exam.status}
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
