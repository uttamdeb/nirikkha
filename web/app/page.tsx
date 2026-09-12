import Link from "next/link";
import { LANDING_MARKUP } from "./landing-markup";
import "./landing.css";

export const metadata = {
  title: "Nirikkha — it does not guess, it asks",
  description:
    "A marking agent for handwritten Creative Question answer scripts. It reads a photograph, marks four parts against their own rubric, and stops the moment it meets a word it cannot make out.",
};

/**
 * The public page.
 *
 * The markup is the design file, injected rather than hand-translated so it
 * stays exactly as drawn — it is static, carries no scripts and takes no user
 * input. Its CSS is scoped under .nk-landing in landing.css, because it uses
 * names like .band and .btn that would otherwise reach into the app.
 *
 * The only live part is the bar below: the way in.
 */
export default function LandingPage() {
  return (
    <div className="nk-landing">
      <nav className="nk-topbar">
        <Link href="/" className="nk-topbar-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" width={28} height={28} />
          <span>
            Nirikkha <span lang="bn">নিরীক্ষা</span>
          </span>
        </Link>
        <div className="nk-topbar-actions">
          <Link href="/login" className="nk-topbar-link">
            Sign in
          </Link>
          <Link href="/dashboard" className="nk-topbar-cta">
            Open the app →
          </Link>
        </div>
      </nav>
      <div dangerouslySetInnerHTML={{ __html: LANDING_MARKUP }} />
    </div>
  );
}
