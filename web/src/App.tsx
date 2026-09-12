import { useEffect, useState } from "react";
import {
  BrowserRouter,
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { getProfile, supabase } from "./lib/api";
import { usePrefs } from "./lib/i18n";
import Toggles from "./components/Toggles";
import AuthPage from "./pages/Auth";
import SubmitPage from "./pages/Submit";
import ResultPage from "./pages/Result";
import InboxPage from "./pages/Inbox";
import ReviewPage from "./pages/Review";
import PanelPageView from "./pages/Panel";
import ConsentPage from "./pages/Consent";

function Shell({ session, role }: { session: Session; role: string }) {
  const navigate = useNavigate();
  const { t } = usePrefs();
  const isTeacher = role === "teacher";

  return (
    <>
      <header className="top">
        <div className="bar">
          <Link to="/" className="brand">
            <span className="brand-mark" role="img" aria-label={t("brand")} />
            {t("brand")}<span>.</span>
          </Link>
          <nav>
            <NavLink to="/" end>{t("navNew")}</NavLink>
            <NavLink to="/inbox">{t("navMine")}</NavLink>
            {isTeacher && <NavLink to="/panel">{t("navPanel")}</NavLink>}
          </nav>
          <div className="spacer" />
          <Toggles />
          <span className="muted" style={{ fontSize: 12.5 }}>
            {session.user.email}
            {isTeacher && <span className="pill done" style={{ marginInlineStart: 7 }}>teacher</span>}
          </span>
          <button
            className="ghost small"
            onClick={async () => {
              await supabase.auth.signOut();
              navigate("/");
            }}
          >
            {t("signOut")}
          </button>
        </div>
      </header>

      <div className="wrap">
        <Routes>
          <Route path="/" element={<SubmitPage />} />
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/s/:id" element={<ResultView isTeacher={isTeacher} />} />
          <Route
            path="/panel"
            element={isTeacher ? <PanelPageView /> : <Navigate to="/" replace />}
          />
          <Route
            path="/review"
            element={isTeacher ? <ReviewPage /> : <Navigate to="/" replace />}
          />
          <Route path="/oauth/consent" element={<ConsentPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </>
  );
}

function ResultView({ isTeacher }: { isTeacher: boolean }) {
  const { id } = useParams<{ id: string }>();
  if (!id) return <Navigate to="/" replace />;
  return <ResultPage id={id} isTeacher={isTeacher} />;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState("student");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setReady(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      setSession(next);
      setReady(true);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) {
      setRole("student");
      return;
    }
    let active = true;
    getProfile(session).then(({ role: r }) => active && setRole(r));
    return () => {
      active = false;
    };
  }, [session]);

  if (!ready) {
    return (
      <div className="center">
        <span className="spin" />
      </div>
    );
  }

  return (
    <BrowserRouter>
      {session ? <Shell session={session} role={role} /> : <AuthPage />}
    </BrowserRouter>
  );
}
