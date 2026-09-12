import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ApiError, apiGet, apiPost } from "../lib/api";
import { usePrefs } from "../lib/i18n";

type TelegramGroup = { id: string; chat_id: string; title: string };
type BatchRow = {
  id: string;
  name: string;
  telegram_group: TelegramGroup | null;
  _count: { members: number; students: number; exams: number };
};

export default function BatchesPage() {
  const { t } = usePrefs();
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [groups, setGroups] = useState<TelegramGroup[]>([]);
  const [name, setName] = useState("");
  const [groupId, setGroupId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    try {
      const [b, g] = await Promise.all([
        apiGet<{ batches: BatchRow[] }>("/api/teacher/batches"),
        apiGet<{ groups: TelegramGroup[] }>("/api/teacher/telegram/groups"),
      ]);
      setBatches(b.batches);
      setGroups(g.groups);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("loadFailed"));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function refreshGroups() {
    setBusy(true);
    setError("");
    try {
      const g = await apiPost<{ groups: TelegramGroup[] }>("/api/teacher/telegram/groups");
      setGroups(g.groups);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("loadFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    try {
      await apiPost("/api/teacher/batches", {
        name: name.trim(),
        telegram_group_id: groupId || null,
      });
      setName("");
      setGroupId("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div>
        <h1>{t("batchesTitle")}</h1>
        <p className="lede">{t("batchesLede")}</p>
      </div>

      {error && <p className="error">{error}</p>}

      <form className="card stack" onSubmit={create}>
        <label>
          {t("batchName")}
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          {t("telegramGroup")}
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">{t("noGroup")}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
        </label>
        <div className="row" style={{ gap: 8 }}>
          <button className="primary" disabled={busy} type="submit">
            {t("createBatch")}
          </button>
          <button className="ghost" type="button" disabled={busy} onClick={() => void refreshGroups()}>
            {t("refreshGroups")}
          </button>
        </div>
      </form>

      <div className="stack">
        {batches.map((batch) => (
          <Link key={batch.id} to={`/batches/${batch.id}`} className="card row">
            <div>
              <strong>{batch.name}</strong>
              <div className="muted" style={{ fontSize: 13 }}>
                {batch.telegram_group?.title || t("noGroup")} ·{" "}
                {t("studentsCount", { n: batch._count.students })}
              </div>
            </div>
            <span className="spacer" />
            <span className="muted">→</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
