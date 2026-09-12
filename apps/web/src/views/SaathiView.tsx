import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentHop, AssistantAnswerOutput } from "@charkha/core";
import { LANGUAGES, detectLang, rememberLang, type Lang } from "../i18n.ts";
import { renderMessage } from "./saathi/messages.ts";
import { ask as liveAsk, type Ask } from "./saathi/ask.ts";
import "./saathi/saathi.css";

/**
 * OWNER: core
 *
 * Saathi — the screen a farmer or a municipal clerk actually uses.
 *
 * Three of the four users our problem statement names — municipalities, farms,
 * food and industrial waste generators — have no other way into this system.
 * The four existing screens are for dispatchers and auditors. This one is a
 * text box.
 *
 * Two things it must never do, both visible in this file:
 *
 *   1. Act without being told twice. Anything that writes arrives as a
 *      proposal with a token; the button sends the token back. The user sees
 *      what they are agreeing to before it happens, never after.
 *
 *   2. Pretend one service answered. Every reply carries the agents it took to
 *      produce, with task ids. A mesh nobody can see is indistinguishable from
 *      a single service with good copy.
 */

type Turn =
  | { who: "user"; text: string }
  | { who: "saathi"; answer: AssistantAnswerOutput; utterance: string }
  | { who: "error"; text: string };

/* Starters, because a blank text box tells you nothing about what it accepts.
   Stored as keys so they translate with everything else. */
const STARTERS: Record<Lang, string[]> = {
  en: ["What happened to our waste in Ludhiana?", "How much CO2 has Ludhiana sequestered?", "Run matching"],
  hi: ["लुधियाना में हमारे कूड़े का क्या हुआ?", "लुधियाना ने कितनी CO2 रोकी?", "मैचिंग चलाओ"],
  pa: ["ਲੁਧਿਆਣਾ ਵਿੱਚ ਸਾਡੇ ਕੂੜੇ ਦਾ ਕੀ ਹੋਇਆ?", "ਲੁਧਿਆਣਾ ਨੇ ਕਿੰਨੀ CO2 ਰੋਕੀ?", "ਮੈਚਿੰਗ ਚਲਾਓ"],
  gu: ["લુધિયાણામાં અમારા કચરાનું શું થયું?", "લુધિયાણાએ કેટલી CO2 રોકી?", "મેચિંગ ચલાવો"],
};

const Hops = ({ hops }: { hops: AgentHop[] }) => {
  if (hops.length === 0) return null;
  return (
    <ul className="sa-hops" aria-label="agents consulted">
      {hops.map((h, i) => (
        <li key={`${h.agent}-${i}`} className={h.ok ? "ok" : "fail"}>
          <b>{h.agent}</b>
          <span>.{h.skill}</span>
          {/* The task id is the point: it is checkable against the ledger. */}
          {h.taskId ? <code>{h.taskId.slice(0, 8)}</code> : <code>no reply</code>}
          <span className="ms">{h.ms} ms</span>
        </li>
      ))}
    </ul>
  );
};

export const SaathiView = ({ ask = liveAsk }: { ask?: Ask }) => {
  const [lang, setLang] = useState<Lang>(() => detectLang());
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  /* Who is asking, kept on the device rather than asked for every sentence.
     A ward clerk says who they are once; a sentence is the wrong place to
     assert an identity, and parsing one out of prose would let anyone retire
     anyone's credit by typing the right name. */
  const [identity, setIdentity] = useState<string>(() => {
    try {
      return localStorage.getItem("charkha.saathi.identity") ?? "";
    } catch {
      return "";
    }
  });
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns, busy]);

  const send = useCallback(
    async (utterance: string, confirm?: string) => {
      if (!utterance.trim() || busy) return;
      setBusy(true);
      /* A confirmation is not a new question - echoing "yes" into the
         transcript would make the record of what was agreed harder to read,
         not easier. */
      if (!confirm) setTurns((t) => [...t, { who: "user", text: utterance }]);
      setDraft("");
      try {
        const answer = await ask(utterance, lang, confirm, identity.trim() || undefined);
        /* Keep the sentence with its answer. Confirming has to re-send the
           original utterance, and reaching backwards through the transcript to
           find it breaks the moment anything else is appended in between. */
        setTurns((t) => [...t, { who: "saathi", answer, utterance }]);
      } catch (e) {
        setTurns((t) => [...t, { who: "error", text: e instanceof Error ? e.message : String(e) }]);
      } finally {
        setBusy(false);
      }
    },
    [ask, lang, busy, identity],
  );

  /* Only the newest proposal is actionable. Leaving an older one live means a
     stale tab can act on something scrolled off screen - and the token is
     bound to its own slots, so a second click would refuse anyway, confusingly. */
  const lastIndex = turns.length - 1;

  return (
    <div className="view saathi">
      <div className="view-head">
        <h1>Saathi</h1>
        <p>
          Ask about your waste in your own language. Anything that changes something is shown to you
          first and only happens when you say yes.
        </p>
      </div>

      <div className="sa-langs" role="group" aria-label="Language">
        {LANGUAGES.map((l) => (
          <button
            key={l.code}
            type="button"
            className={l.code === lang ? "sa-lang on" : "sa-lang"}
            aria-pressed={l.code === lang}
            onClick={() => {
              setLang(l.code as Lang);
              rememberLang(l.code as Lang);
            }}
          >
            {l.label}
          </button>
        ))}
      </div>

      <label className="sa-identity">
        <span>You are</span>
        <input
          value={identity}
          onChange={(e) => {
            setIdentity(e.target.value);
            try {
              localStorage.setItem("charkha.saathi.identity", e.target.value);
            } catch {
              /* A private window still works; it just forgets between visits. */
            }
          }}
          placeholder="Ward 7, Ludhiana Municipal Corporation"
          aria-label="Who you are"
        />
      </label>

      <div className="sa-thread">
        {turns.length === 0 ? (
          <div className="sa-starters">
            {STARTERS[lang].map((s) => (
              <button key={s} type="button" onClick={() => void send(s)}>
                {s}
              </button>
            ))}
          </div>
        ) : null}

        {turns.map((turn, i) => {
          if (turn.who === "user") {
            return (
              <p key={i} className="sa-turn user">
                {turn.text}
              </p>
            );
          }
          if (turn.who === "error") {
            return (
              <p key={i} className="sa-turn err">
                {turn.text}
              </p>
            );
          }

          const a = turn.answer;
          const pending = a.confirmation && i === lastIndex;
          return (
            <div key={i} className="sa-turn saathi">
              <p>{renderMessage(a.reply, lang)}</p>

              {pending ? (
                <div className="sa-confirm">
                  <button
                    type="button"
                    className="yes"
                    disabled={busy}
                    onClick={() => void send(turn.utterance, a.confirmation?.token)}
                  >
                    Yes, do it
                  </button>
                  <button type="button" disabled={busy} onClick={() => setTurns((t) => [...t, { who: "error", text: "Cancelled. Nothing was changed." }])}>
                    No
                  </button>
                </div>
              ) : null}

              {a.performed ? <span className="sa-done">done</span> : null}
              <Hops hops={a.hops} />
            </div>
          );
        })}

        {busy ? <p className="sa-turn saathi muted">…</p> : null}
        <div ref={endRef} />
      </div>

      <form
        className="sa-ask"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask about your waste"
          aria-label="Ask about your waste"
          disabled={busy}
        />
        <button type="submit" disabled={busy || draft.trim() === ""}>
          Ask
        </button>
      </form>
    </div>
  );
};
