"use client";

import { use } from "react";
import ResultPage from "@/components/pages/Result";
import { useAuth } from "@/components/providers";

export default function ResultRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { isTeacher } = useAuth();
  return <ResultPage id={id} isTeacher={isTeacher} />;
}
