import { useCallback, useEffect, useMemo, useState } from "react";
import type { DecisionRecord } from "@charkha/core";
import { api } from "../api.ts";
import "./MeshView.css";

/**
 * OWNER: core
 *
 * The agent mesh, live.
 *
 * We claim four independent agents speaking an open protocol, every decision
 * hash-chained. Until now that claim was four grey dots in the corner, and a
 * judge had to take the architecture on faith while looking at what could
 * have been one CRUD app. This screen is the claim, shown.
 *
 * Everything here is derived from data the system already produces - the
 * decision log and the health endpoint. Nothing is staged for the demo.
 */

type Agent = "producer" | "matchmaker" | "verifier" | "registry";

const AGENTS: Array<{ id: Agent; title: string; role: string; port: number }> = [
  { id: "producer", title: "Producer", role: "publishes residue lots from satellite detections", port: 4001 },
  { id: "matchmaker", title: "Matchmaker", role: "assigns lots to conversion units", port: 4002 },
  { id: "verifier", title: "Verifier", role: "scores field evidence, runs methodology checks", port: 4003 },
  { id: "registry", title: "Registry", role: "computes tCO2e, issues and retires credentials", port: 4004 },
];

const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-4)}`;
const ago = (iso: string): string => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
};

export const MeshView = () => {
  const [health, setHealth] = useState<{ agents: Array<{ name: string; up: boolean }> } | null>(null);
  const [chain, setChain] = useState<DecisionRecord[]>([]);
  const [valid, setValid] = useState<boolean | null>(null);
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [h, l] = await Promise.all([api.health(), api.ledger()]);
      setHealth(h);
      setChain(l.chain as DecisionRecord[]);
      setValid(l.verdict.valid);
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [load]);

  const up = useMemo(
    () => new Map((health?.agents ?? []).map((a) => [a.name, a.up])),
    [health],
  );

  /* How much has each agent actually done, and when did it last act. */
  const stats = useMemo(() => {
    const m = new Map<string, { count: number; last?: DecisionRecord }>();
    for (const rec of chain) {
      const cur = m.get(rec.agent) ?? { count: 0 };
      cur.count += 1;
      cur.last = rec;
      m.set(rec.agent, cur);
    }
    return m;
  }, [chain]);

  /* Tasks, newest first. One task is one thread through the mesh, which is
     exactly what the pitch asks a judge to follow. */
  const tasks = useMemo(() => {
    const byTask = new Map<string, DecisionRecord[]>();
    for (const rec of chain) {
      const list = byTask.get(rec.taskId) ?? [];
      list.push(rec);
      byTask.set(rec.taskId, list);
    }
    return [...byTask.entries()]
      .map(([taskId, records]) => ({ taskId, records }))
      .sort((a, b) => (a.records[0]!.seq < b.records[0]!.seq ? 1 : -1))
      .slice(0, 12);
  }, [chain]);

  const recent = useMemo(() => [...chain].reverse().slice(0, 14), [chain]);
  const activeTask = tasks.find((t) => t.taskId === selected) ?? null;

  /* An agent counts as "live" if it acted in the last half minute - that is
     what makes the mesh look like it is running rather than merely up. */
  const isActive = (id: Agent) => {
    const last = stats.get(id)?.last;
    return last ? Date.now() - new Date(last.at).getTime() < 30_000 : false;
  };

  return (
    <div className="view mesh-view">
      <div className="view-head">
        <h1>Agent mesh</h1>
        <p>
          Four independent services speaking Agent2Agent. Every decision below was written by one of
          them and hash-chained to the one before it — nothing here is staged.
        </p>
      </div>

      {err ? <p className="err">{err}</p> : null}

      <div className="mv-chainstate">
        <span className={valid === null ? "mv-stamp" : valid ? "mv-stamp ok" : "mv-stamp bad"}>
          {valid === null ? "checking" : valid ? "chain valid" : "chain broken"}
        </span>
        <span className="mv-count">
          <b>{chain.length}</b> decisions
        </span>
        <span className="mv-count">
          <b>{tasks.length}</b> recent tasks
        </span>
      </div>

      {/* The mesh itself. Pipeline order left to right, because that is the
          order a credit is actually built in. */}
      <div className="mv-rail">
        {AGENTS.map((a, i) => {
          const s = stats.get(a.id);
          return (
            <div key={a.id} className="mv-node-wrap">
              <article className={`mv-node${isActive(a.id) ? " live" : ""}${up.get(a.id) === false ? " down" : ""}`}>
                <header>
                  <span className={up.get(a.id) ? "mv-dot up" : "mv-dot down"} />
                  <h2>{a.title}</h2>
                  <code>:{a.port}</code>
                </header>
                <p className="mv-role">{a.role}</p>
                <div className="mv-figs">
                  <div>
                    <b>{s?.count ?? 0}</b>
                    <span>decisions</span>
                  </div>
                  <div>
                    <b>{s?.last ? ago(s.last.at) : "—"}</b>
                    <span>last acted</span>
                  </div>
                </div>
                {s?.last ? <code className="mv-lastaction">{s.last.action}</code> : null}
              </article>
              {i < AGENTS.length - 1 ? <span className="mv-arrow" aria-hidden="true" /> : null}
            </div>
          );
        })}
      </div>

      <div className="mv-grid">
        <section className="mv-panel">
          <header>
            <h2>Tasks through the mesh</h2>
            <span className="muted">one task id, one thread</span>
          </header>
          {tasks.length === 0 ? (
            <p className="muted mv-empty">
              No decisions yet. Pull detections on the Operator view and the mesh starts writing.
            </p>
          ) : (
            <ul className="mv-tasks">
              {tasks.map((t) => (
                <li key={t.taskId}>
                  <button
                    type="button"
                    className={t.taskId === selected ? "on" : ""}
                    onClick={() => setSelected(t.taskId === selected ? null : t.taskId)}
                  >
                    <code>{short(t.taskId)}</code>
                    <span className="mv-hops">
                      {t.records.map((r) => (
                        <span key={r.seq} className={`mv-hop ${r.agent}`} title={`${r.agent} · ${r.action}`} />
                      ))}
                    </span>
                    <span className="muted">{ago(t.records.at(-1)!.at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {activeTask ? (
            <div className="mv-thread">
              {activeTask.records.map((r) => (
                <div key={r.seq} className="mv-threadrow">
                  <span className={`mv-chip ${r.agent}`}>{r.agent}</span>
                  <code>{r.action}</code>
                  <span className="muted">
                    #{r.seq} · {r.confidence === null ? "no confidence" : `confidence ${r.confidence}`}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <section className="mv-panel">
          <header>
            <h2>Decision log</h2>
            <span className="muted">newest first</span>
          </header>
          {recent.length === 0 ? (
            <p className="muted mv-empty">Nothing written yet.</p>
          ) : (
            <ol className="mv-log">
              {recent.map((r) => (
                <li key={r.seq}>
                  <span className="mv-seq">#{r.seq}</span>
                  <span className={`mv-chip ${r.agent}`}>{r.agent}</span>
                  <code className="mv-act">{r.action}</code>
                  <code className="mv-hash" title={`hash ${r.hash}\nprev ${r.prevHash}`}>
                    {short(r.hash)}
                  </code>
                  <span className="muted">{ago(r.at)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
};
