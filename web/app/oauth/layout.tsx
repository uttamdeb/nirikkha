import { Providers } from "@/components/providers";

/** The consent screen needs a session, so the app boots here rather than at the root. */
export default function OAuthLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
