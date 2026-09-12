import { usePrefs } from "../lib/i18n";

/** Language and theme switches. Both persist per browser. */
export default function Toggles() {
  const { lang, theme, setLang, setTheme } = usePrefs();

  return (
    <div className="toggles">
      <div className="toggle" role="group" aria-label="Language">
        <button aria-pressed={lang === "bn"} onClick={() => setLang("bn")}>
          বাংলা
        </button>
        <button aria-pressed={lang === "en"} onClick={() => setLang("en")}>
          EN
        </button>
      </div>
      <div className="toggle" role="group" aria-label="Theme">
        <button
          aria-pressed={theme === "light"}
          onClick={() => setTheme("light")}
          title="Light"
        >
          ☀
        </button>
        <button
          aria-pressed={theme === "dark"}
          onClick={() => setTheme("dark")}
          title="Dark"
        >
          ☾
        </button>
      </div>
    </div>
  );
}
