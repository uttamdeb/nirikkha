import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, apiGet } from "../lib/api";
import { usePrefs } from "../lib/i18n";

type ExamRow = {
  id: string;
  title: string;
  exam_code: string | null;
  status: string;
  batch: { id: string; name: string } | null;
  _count: { questions: number; approved: number };
};

export default function ExamsPage() {
  const { t } = usePrefs();
  const [exams, setExams] = useState<ExamRow[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiGet<{ exams: ExamRow[] }>("/api/teacher/exams");
        setExams(data.exams);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t("loadFailed"));
      }
    })();
  }, [t]);

  const statusLabel = (status: string) => {
    if (status === "published") return t("published");
    if (status === "closed") return t("closed");
    return t("draft");
  };

  return (
    <div className="stack">
      <div className="row">
        <div>
          <h1>{t("examsTitle")}</h1>
          <p className="lede">{t("examsLede")}</p>
        </div>
        <span className="spacer" />
        <Link className="primary small" to="/exams/new">
          {t("createExam")}
        </Link>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="stack">
        {exams.map((exam) => (
          <Link key={exam.id} to={`/exams/${exam.id}`} className="card row">
            <div>
              <strong>{exam.title}</strong>
              <div className="muted" style={{ fontSize: 13 }}>
                {exam.exam_code || "—"} · {statusLabel(exam.status)}
                {exam.batch ? ` · ${exam.batch.name}` : ""}
                {" · "}
                {exam._count.approved}/{exam._count.questions}
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
