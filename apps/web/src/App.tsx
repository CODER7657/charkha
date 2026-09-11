import { useEffect, useState } from "react";
import { OperatorMap } from "./views/OperatorMap.tsx";
import { AuditConsole } from "./views/AuditConsole.tsx";
import { FieldCapture } from "./views/FieldCapture.tsx";
import { api } from "./api.ts";

type View = "operator" | "audit" | "field";

const VIEWS: Array<{ id: View; label: string; owner: string }> = [
  { id: "operator", label: "Operator", owner: "Harsh" },
  { id: "audit", label: "Audit", owner: "Ayush" },
  { id: "field", label: "Field", owner: "Hem" },
];

/** Deep link so the phone can open straight onto the field view: /#field */
const initial = (): View => {
  const h = window.location.hash.replace("#", "");
  return VIEWS.some((v) => v.id === h) ? (h as View) : "operator";
};

export const App = () => {
  const [view, setView] = useState<View>(initial);
  const [health, setHealth] = useState<Awaited<ReturnType<typeof api.health>> | null>(null);

  useEffect(() => {
    const tick = () => void api.health().then(setHealth).catch(() => setHealth(null));
    tick();
    const t = setInterval(tick, 10_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    window.location.hash = view;
  }, [view]);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="mark" aria-hidden="true" />
          <span>Charkha</span>
        </div>
        <nav className="tabs">
          {VIEWS.map((v) => (
            <button key={v.id} className={v.id === view ? "tab on" : "tab"} onClick={() => setView(v.id)}>
              {v.label}
            </button>
          ))}
        </nav>
        <div className="mesh" title="agent mesh health">
          {(health?.agents ?? []).map((a) => (
            <span key={a.name} className={a.up ? "dot up" : "dot down"} title={`${a.name} ${a.up ? "up" : "down"}`} />
          ))}
        </div>
      </header>
      <main className="main">
        {view === "operator" && <OperatorMap />}
        {view === "audit" && <AuditConsole />}
        {view === "field" && <FieldCapture />}
      </main>
    </div>
  );
};
