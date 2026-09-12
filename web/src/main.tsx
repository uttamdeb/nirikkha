import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { loadConfig } from "./lib/config";
import { initApi } from "./lib/api";
import { PrefsProvider, usePrefs } from "./lib/i18n";
import "katex/dist/katex.min.css";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);

function Fatal({ message }: { message: string }) {
  const { t } = usePrefs();
  return (
    <div className="center">
      <div className="card auth-card">
        <h2>{t("bootFailed")}</h2>
        <p className="muted">{message}</p>
        <button onClick={() => window.location.reload()}>{t("retry")}</button>
      </div>
    </div>
  );
}

loadConfig()
  .then((config) => {
    initApi(config);
    root.render(
      <React.StrictMode>
        <PrefsProvider>
          <App />
        </PrefsProvider>
      </React.StrictMode>,
    );
  })
  .catch((error: unknown) => {
    // Renders the reason instead of a blank page.
    root.render(
      <PrefsProvider>
        <Fatal message={error instanceof Error ? error.message : String(error)} />
      </PrefsProvider>,
    );
  });
