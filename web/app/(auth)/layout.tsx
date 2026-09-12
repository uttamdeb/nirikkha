import { Providers } from "@/components/providers";

/** Signing in needs a session, so the app boots here rather than at the root. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
