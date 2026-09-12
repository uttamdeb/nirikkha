"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpenIcon } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { LoadingBlock } from "@/components/feedback/loading-block";
import { StatusBadge } from "@/components/feedback/status-badge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ApiError, apiGet } from "@/lib/api";
import { usePrefs } from "@/lib/i18n";

interface ExamRow {
  id: string;
  title: string;
  exam_code: string | null;
  status: string;
  batch: { id: string; name: string } | null;
  _count: { questions: number; approved: number };
}

function getExamStatusLabel(status: string, t: ReturnType<typeof usePrefs>["t"]) {
  if (status === "published") return t("published");
  if (status === "closed") return t("closed");
  return t("draft");
}

export default function ExamsPage() {
  const { t } = usePrefs();
  const [exams, setExams] = useState<ExamRow[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiGet<{ exams: ExamRow[] }>("/api/teacher/exams");
        setExams(data.exams);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t("loadFailed"));
        setExams([]);
      }
    })();
  }, [t]);

  if (!exams) return <LoadingBlock rows={5} className="max-w-none" />;

  return (
    <div className="space-y-4">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {exams.length === 0 ? (
        <EmptyState
          icon={<BookOpenIcon className="size-5" />}
          title={t("examsEmptyTitle")}
          description={t("examsEmptyDescription")}
          action={
            <Button asChild>
              <Link href="/exams/new">{t("createExam")}</Link>
            </Button>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("examTitle")}</TableHead>
                <TableHead>{t("tableCode")}</TableHead>
                <TableHead>{t("statusLabelShort")}</TableHead>
                <TableHead>{t("tableBatch")}</TableHead>
                <TableHead>{t("tableQuestions")}</TableHead>
                <TableHead>{t("tableApproved")}</TableHead>
                <TableHead className="text-right">{t("actionOpen")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {exams.map((exam) => (
                <TableRow key={exam.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/exams/${exam.id}`}
                      className="transition-colors hover:text-teal"
                    >
                      {exam.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {exam.exam_code ? (
                      <Badge variant="outline" className="font-mono">
                        {exam.exam_code}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      status={exam.status}
                      label={getExamStatusLabel(exam.status, t)}
                    />
                  </TableCell>
                  <TableCell>{exam.batch?.name ?? "—"}</TableCell>
                  <TableCell className="tabular-nums">{exam._count.questions}</TableCell>
                  <TableCell className="tabular-nums">{exam._count.approved}</TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/exams/${exam.id}`}>{t("actionOpen")}</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
