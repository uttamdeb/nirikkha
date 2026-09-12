"use client";

import { use } from "react";
import BatchDetailPage from "@/components/pages/BatchDetail";
import { TeacherOnly } from "@/components/teacher-only";

export default function BatchDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  use(params); // ensure params resolved; page reads useParams
  return (
    <TeacherOnly>
      <BatchDetailPage />
    </TeacherOnly>
  );
}
