import { Suspense } from "react";
import LoginPage from "./login-client";
import { LoadingBlock } from "@/components/feedback/loading-block";

export default function LoginRoute() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <LoadingBlock />
        </div>
      }
    >
      <LoginPage />
    </Suspense>
  );
}
