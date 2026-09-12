"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ApiError, apiGet, apiPatch, apiPost, apiPut } from "@/lib/api";
import { EmptyState } from "@/components/feedback/empty-state";
import { LoadingBlock } from "@/components/feedback/loading-block";
import { StatusBadge } from "@/components/feedback/status-badge";
import { PageShell } from "@/components/layout/page-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePrefs } from "@/lib/i18n";

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
  const params = useParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : params.id?.[0];
  const { t } = usePrefs();
  const [batch, setBatch] = useState<BatchDetail | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
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
  }, [id, t]);

  function getExamStatusLabel(status: string): string {
    if (status === "published") return t("published");
    if (status === "closed") return t("closed");
    return t("draft");
  }

  async function sync(postEnroll: boolean) {
    if (!id) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiPost(`/api/teacher/batches/${id}/sync-members`, { post_enroll: postEnroll });
      setNotice(t("syncMembers"));
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
    setNotice("");
    try {
      await apiPut(`/api/teacher/batches/${id}/sync-members`);
      setNotice(t("postRegister"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function saveNumber(memberId: string) {
    if (!id) return;
    const raw = edits[memberId];
    const trimmed = raw.trim();
    const student_number = trimmed === "" ? null : Number.parseInt(trimmed, 10);
    if (
      trimmed !== "" &&
      (!Number.isFinite(student_number) || student_number === null || student_number < 1)
    ) {
      setError(t("saveFailed"));
      return;
    }
    setError("");
    setNotice("");
    try {
      await apiPatch(`/api/teacher/batches/${id}/members/${memberId}`, { student_number });
      setNotice(t("saveLine"));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("saveFailed"));
    }
  }

  const content = !batch ? (
    error ? (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    ) : (
      <LoadingBlock rows={5} className="max-w-none" />
    )
  ) : (
    <div className="space-y-4">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {notice ? (
        <Alert>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy} onClick={() => void sync(true)}>
          {t("syncMembers")}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void postRegister()}>
          {t("postRegister")}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("members")}</CardTitle>
          <CardDescription>{t("membersLede")}</CardDescription>
        </CardHeader>
        <CardContent>
          {batch.members.length === 0 ? (
            <EmptyState
              title={t("membersEmptyTitle")}
              description={t("membersEmptyDescription")}
              className="border-0 bg-transparent px-0 py-6 shadow-none"
            />
          ) : (
            <div className="overflow-hidden rounded-xl border border-border/70">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("studentNumber")}</TableHead>
                    <TableHead>{t("tableName")}</TableHead>
                    <TableHead>{t("tableTelegramId")}</TableHead>
                    <TableHead>{t("tableRole")}</TableHead>
                    <TableHead className="text-right">{t("saveLine")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batch.members.map((member) => (
                    <TableRow key={member.id}>
                      <TableCell className="w-28">
                        <Input
                          value={edits[member.id] ?? ""}
                          onChange={(event) =>
                            setEdits((prev) => ({
                              ...prev,
                              [member.id]: event.target.value,
                            }))
                          }
                          disabled={member.is_group_admin}
                          inputMode="numeric"
                        />
                      </TableCell>
                      <TableCell className="font-medium">{member.display_name}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {member.telegram_user_id}
                      </TableCell>
                      <TableCell>
                        <Badge variant={member.is_group_admin ? "default" : "secondary"}>
                          {member.is_group_admin ? t("adminRole") : t("studentRole")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {!member.is_group_admin ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => void saveNumber(member.id)}
                          >
                            {t("saveLine")}
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {batch.exams.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("relatedExams")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {batch.exams.map((exam) => (
              <Link
                key={exam.id}
                href={`/exams/${exam.id}`}
                className="flex flex-col gap-2 rounded-xl border border-border/70 bg-muted/20 p-4 transition hover:border-teal/40 hover:shadow-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-1">
                  <p className="font-medium">{exam.title}</p>
                  <p className="text-xs text-muted-foreground">{exam.exam_code || "—"}</p>
                </div>
                <StatusBadge
                  status={exam.status}
                  label={getExamStatusLabel(exam.status)}
                />
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );

  return (
    <PageShell
      title={batch?.name ?? t("batchesTitle")}
      description={batch?.telegram_group?.title || t("noGroup")}
      breadcrumbs={[
        { label: t("batchesTitle"), href: "/batches" },
        { label: batch?.name ?? t("actionOpen") },
      ]}
    >
      {content}
    </PageShell>
  );
}
