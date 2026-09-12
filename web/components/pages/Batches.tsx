"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { UsersIcon } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { LoadingBlock } from "@/components/feedback/loading-block";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import { usePrefs } from "@/lib/i18n";

interface TelegramGroup {
  id: string;
  chat_id: string;
  title: string;
}

interface BatchRow {
  id: string;
  name: string;
  telegram_group: TelegramGroup | null;
  _count: { members: number; students: number; exams: number };
}

export default function BatchesPage() {
  const { t } = usePrefs();
  const [batches, setBatches] = useState<BatchRow[] | null>(null);
  const [groups, setGroups] = useState<TelegramGroup[]>([]);
  const [name, setName] = useState("");
  const [groupId, setGroupId] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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
      setBatches([]);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function refreshGroups() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const g = await apiPost<{ groups: TelegramGroup[] }>("/api/teacher/telegram/groups");
      setGroups(g.groups);
      setNotice(t("refreshGroups"));
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
    setNotice("");
    try {
      await apiPost("/api/teacher/batches", {
        name: name.trim(),
        telegram_group_id: groupId || null,
      });
      setName("");
      setGroupId("");
      setOpen(false);
      setNotice(t("createBatch"));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (!batches) return <LoadingBlock rows={5} className="max-w-none" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={() => void refreshGroups()}>
          {t("refreshGroups")}
        </Button>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>{t("createBatch")}</Button>
          </DialogTrigger>
          <DialogContent>
            <form className="space-y-4" onSubmit={create}>
              <DialogHeader>
                <DialogTitle>{t("createBatch")}</DialogTitle>
                <DialogDescription>{t("createBatchLede")}</DialogDescription>
              </DialogHeader>

              <div className="space-y-2">
                <Label htmlFor="batch-name">{t("batchName")}</Label>
                <Input
                  id="batch-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="batch-group">{t("telegramGroup")}</Label>
                <Select
                  value={groupId || "none"}
                  onValueChange={(value) => setGroupId(value === "none" ? "" : value)}
                >
                  <SelectTrigger id="batch-group" className="w-full rounded-lg bg-card">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("noGroup")}</SelectItem>
                    {groups.map((group) => (
                      <SelectItem key={group.id} value={group.id}>
                        {group.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <DialogFooter>
                <Button type="submit" disabled={busy || !name.trim()}>
                  {t("createBatch")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

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

      {batches.length === 0 ? (
        <EmptyState
          icon={<UsersIcon className="size-5" />}
          title={t("batchesEmptyTitle")}
          description={t("batchesEmptyDescription")}
          action={
            <Button type="button" onClick={() => setOpen(true)}>
              {t("createBatch")}
            </Button>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("tableName")}</TableHead>
                <TableHead>{t("tableGroup")}</TableHead>
                <TableHead>{t("tableStudents")}</TableHead>
                <TableHead>{t("tableMembers")}</TableHead>
                <TableHead>{t("tableExams")}</TableHead>
                <TableHead className="text-right">{t("actionOpen")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map((batch) => (
                <TableRow key={batch.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/batches/${batch.id}`}
                      className="transition-colors hover:text-teal"
                    >
                      {batch.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {batch.telegram_group ? (
                      <Badge variant="outline">{batch.telegram_group.title}</Badge>
                    ) : (
                      t("noGroup")
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">{batch._count.students}</TableCell>
                  <TableCell className="tabular-nums">{batch._count.members}</TableCell>
                  <TableCell className="tabular-nums">{batch._count.exams}</TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/batches/${batch.id}`}>{t("actionOpen")}</Link>
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
