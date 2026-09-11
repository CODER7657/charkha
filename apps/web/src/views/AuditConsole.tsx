import { useCallback, useEffect, useMemo, useState } from "react";
import { verifyChain, type ChainVerdict, type CreditRecord, type DecisionRecord, type TraceBundle } from "@charkha/core";
import { api } from "../api.ts";
import "./AuditConsole.css";

/**
 * OWNER: Ayush
 *
 * The audit console. Two claims are made on this screen and both are
 * demonstrated rather than asserted:
 *
 *   1. the decision chain is verified HERE, in your browser, with the same
 *      verifyChain the server runs. Edit any field and it goes red at
 *      exactly that record.
 *   2. the credential's signature is checked against the issuer's DID,
 *      resolved locally. Our database is never asked to vouch for itself.
 */

const truncate = (hash: string, head = 8) => `${hash.slice(0, head)}...${hash.slice(-4)}`;

/** Click any hash to copy it - judges ask for these. */
const Hash = ({ value, label }: { value: string; label?: string }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={copied ? "hash copied" : "hash"}
      title={`${label ? `${label}: ` : ""}${value}\n(click to copy)`}
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      {label ? `${label} ` : ""}
      {truncate(value)}
    </button>
  );
};

type DecodedCredential = { header: unknown; payload: Record<string, unknown> };

/** Decode a JWT for display. Decoding is not verifying - that is the button below. */
const decodeJwt = (jwt: string): DecodedCredential => {
  const [header, payload] = jwt.split(".");
  const parse = (part: string) =>
    JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))));
  return { header: parse(header!), payload: parse(payload!) as Record<string, unknown> };
};

type SignatureCheck =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "ok"; issuer: string }
  | { state: "failed"; reason: string };

export const AuditConsole = () => {
  const [chain, setChain] = useState<DecisionRecord[]>([]);
  const [pristine, setPristine] = useState<DecisionRecord[]>([]);
  const [serverSaid, setServerSaid] = useState<boolean | null>(null);
  const [verdict, setVerdict] = useState<ChainVerdict | null>(null);
  const [tamperMode, setTamperMode] = useState(false);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const { chain: records, verdict: theirs } = await api.ledger();
      const typed = records as DecisionRecord[];
      setChain(typed);
      setPristine(typed);
      setServerSaid(theirs.valid);
      setVerdict(null);
      setTamperMode(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void load(), [load]);

  /**
   * A console left open on stage goes stale while the demo happens behind it -
   * you come back from the phone and the ledger is the one from ten minutes
   * ago. Refresh when the tab returns to the foreground.
   *
   * Never mid-tamper-demo: reloading then would wipe the judge's edit under
   * their hands and reset the banner they are looking at.
   */
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible" && !tamperMode) void load();
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [load, tamperMode]);

  /* The whole point: we re-derive every hash here, not on the server. */
  const verifyHere = useCallback(() => setVerdict(verifyChain(chain)), [chain]);

  const tamper = (seq: number, field: "action" | "confidence", raw: string) => {
    setChain((current) =>
      current.map((rec) =>
        rec.seq === seq
          ? { ...rec, [field]: field === "confidence" ? (raw === "" ? null : Number(raw)) : raw }
          : rec,
      ),
    );
    // Re-verify as they type: the banner flips the instant the record stops matching its hash.
    setVerdict(null);
  };

  const edited = useMemo(
    () => new Set(chain.filter((rec, i) => JSON.stringify(rec) !== JSON.stringify(pristine[i])).map((r) => r.seq)),
    [chain, pristine],
  );

  const brokenAt = verdict && !verdict.valid ? verdict.brokenAtSeq : null;

  const banner = !verdict
    ? { className: "unknown", stamp: "NOT VERIFIED HERE", detail: serverSaid === null ? "" : `the server reports ${serverSaid ? "valid" : "BROKEN"} - do not take its word for it` }
    : verdict.valid
      ? { className: "valid", stamp: "CHAIN VALID", detail: `${verdict.length} records re-hashed in this browser` }
      : { className: "broken", stamp: `BROKEN AT seq ${verdict.brokenAtSeq}`, detail: verdict.reason };

  return (
    <div className="view audit">
      <div className="view-head">
        <h1>Audit</h1>
        <p>Every decision, hash-chained. Tamper with one and the chain says exactly where.</p>
      </div>

      <div className={`audit-verdict ${banner.className}`}>
        <span className="stamp">{banner.stamp}</span>
        <span className="detail">{banner.detail}</span>
      </div>

      <div className="audit-toolbar">
        <button type="button" className="primary" onClick={verifyHere} disabled={chain.length === 0}>
          Verify chain in this browser
        </button>
        <button type="button" onClick={() => setTamperMode((on) => !on)} disabled={chain.length === 0}>
          {tamperMode ? "Stop editing" : "Tamper demo"}
        </button>
        {edited.size > 0 ? (
          <button type="button" className="danger" onClick={() => { setChain(pristine); setVerdict(null); }}>
            Restore {edited.size} edited record{edited.size > 1 ? "s" : ""}
          </button>
        ) : null}
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? "Loading..." : "Reload ledger"}
        </button>
      </div>

      {err ? <p className="err">{err}</p> : null}

      <div className="grid">
        <section className="card">
          <header>
            <h2>Decision log</h2>
            <span className="muted">{chain.length} records</span>
          </header>
          {tamperMode ? (
            <p className="tamper-note">
              Edit an action or a confidence below, then verify again. The record no longer matches the hash it was
              written with, and every record after it is orphaned.
            </p>
          ) : null}
          <ul className="chain">
            {chain.map((rec) => (
              <li
                key={rec.seq}
                className={
                  brokenAt === rec.seq ? "broken-here" : brokenAt !== null && rec.seq > brokenAt ? "after-break" : ""
                }
              >
                <span className="seq">#{rec.seq}</span>
                <div>
                  <div className="row1">
                    <span className="agent">{rec.agent}</span>
                    {tamperMode ? (
                      <input
                        className="edit"
                        value={rec.action}
                        aria-label={`action for record ${rec.seq}`}
                        onChange={(e) => tamper(rec.seq, "action", e.target.value)}
                      />
                    ) : (
                      <span className="action">{rec.action}</span>
                    )}
                    {edited.has(rec.seq) ? <span className="edited">edited</span> : null}
                    <span className="confidence">
                      {tamperMode ? (
                        <input
                          className="edit"
                          value={rec.confidence ?? ""}
                          aria-label={`confidence for record ${rec.seq}`}
                          onChange={(e) => tamper(rec.seq, "confidence", e.target.value)}
                        />
                      ) : rec.confidence === null ? (
                        "no confidence"
                      ) : (
                        `confidence ${rec.confidence.toFixed(2)}`
                      )}
                    </span>
                  </div>
                  <div className="row2">
                    <Hash value={rec.hash} label="hash" />
                    <Hash value={rec.prevHash} label="prev" />
                    {rec.modelHash ? <Hash value={rec.modelHash} label="model" /> : null}
                    <span>{new Date(rec.at).toLocaleString()}</span>
                  </div>
                </div>
              </li>
            ))}
            {chain.length === 0 && !loading ? (
              <li>
                <span className="seq" />
                <span className="muted">No decisions yet. Run the pipeline and they land here.</span>
              </li>
            ) : null}
          </ul>
        </section>

        <CredentialPanel />
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ *
 * Credential panel: paste a task id, get the credential, check the
 * signature against the issuer DID resolved in this browser.
 * ------------------------------------------------------------------ */

const CredentialPanel = () => {
  const [taskId, setTaskId] = useState("");
  const [trace, setTrace] = useState<TraceBundle | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<SignatureCheck>({ state: "idle" });
  const [showRaw, setShowRaw] = useState(false);

  const credit: CreditRecord | null = trace?.credit ?? null;
  const decoded = useMemo(() => {
    if (!credit) return null;
    try {
      return decodeJwt(credit.credentialJwt);
    } catch {
      return null;
    }
  }, [credit]);

  const lookup = async () => {
    setBusy(true);
    setErr("");
    setCheck({ state: "idle" });
    try {
      setTrace((await api.trace(taskId.trim())) as TraceBundle);
    } catch (e) {
      setTrace(null);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /* Really verifies: resolve the issuer's did:key locally, check the
     signature over the JWT. Nothing here trusts our own database. */
  const verifySignature = async () => {
    if (!credit) return;
    setCheck({ state: "checking" });
    try {
      const [{ verifyCredential }, { Resolver }, keyDidResolver] = await Promise.all([
        import("did-jwt-vc"),
        import("did-resolver"),
        import("key-did-resolver"),
      ]);
      type Registry = ConstructorParameters<typeof Resolver>[0];
      // key-did-resolver does not declare did-resolver as a dependency, so its
      // types can resolve against a different copy than did-jwt-vc's. Same
      // shape at runtime.
      const resolver = new Resolver(keyDidResolver.getResolver() as Registry);
      const result = await verifyCredential(credit.credentialJwt, resolver);
      setCheck(
        result.verified
          ? { state: "ok", issuer: String(result.issuer) }
          : { state: "failed", reason: "signature did not verify" },
      );
    } catch (e) {
      setCheck({ state: "failed", reason: e instanceof Error ? e.message : String(e) });
    }
  };

  const subject = (decoded?.payload["vc"] as { credentialSubject?: Record<string, Record<string, unknown>> } | undefined)
    ?.credentialSubject;
  const status = (decoded?.payload["vc"] as { credentialStatus?: Record<string, string> } | undefined)
    ?.credentialStatus;

  return (
    <section className="card">
      <header>
        <h2>Credential</h2>
        {credit ? <span className={`pill ${credit.status}`}>{credit.status}</span> : null}
      </header>
      <div className="body">
        <div className="lookup">
          <input
            value={taskId}
            placeholder="paste an A2A task id"
            aria-label="task id"
            onChange={(e) => setTaskId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void lookup()}
          />
          <button type="button" onClick={() => void lookup()} disabled={busy || taskId.trim() === ""}>
            {busy ? "..." : "Trace"}
          </button>
        </div>

        {err ? <p className="err">{err}</p> : null}

        {trace ? (
          <ul className="thread">
            <li className={trace.match ? "on" : ""}>match</li>
            <li className={trace.evidence ? "on" : ""}>evidence</li>
            <li className={trace.verification ? "on" : ""}>verification</li>
            <li className={trace.credit ? "on" : ""}>credential</li>
            <li className={trace.chainValid ? "on" : ""}>{trace.chain.length} decisions</li>
          </ul>
        ) : null}

        {credit && decoded ? (
          <>
            <dl className="claims">
              <dt>net removal</dt>
              <dd>
                <span className="figure">{credit.netTonnesCo2e}</span> tCO2e
              </dd>
              <dt>gross</dt>
              <dd>{credit.breakdown.grossSequestrationTco2e} tCO2e</dd>
              <dt>transport debit</dt>
              <dd>-{credit.breakdown.transportDebitTco2e} tCO2e</dd>
              <dt>process debit</dt>
              <dd>-{credit.breakdown.processDebitTco2e} tCO2e</dd>
              <dt>issuer</dt>
              <dd>
                <Hash value={credit.issuerDid} />
              </dd>
              <dt>credential</dt>
              <dd>{credit.credentialId}</dd>
              {subject?.["model"] ? (
                <>
                  <dt>model</dt>
                  <dd>
                    {String(subject["model"]["modelVersion"])}{" "}
                    <Hash value={String(subject["model"]["modelHash"])} />
                  </dd>
                </>
              ) : null}
              {subject?.["chainOfCustody"] ? (
                <>
                  <dt>custody</dt>
                  <dd>
                    <Hash value={String(subject["chainOfCustody"]["decisionLogHash"])} label="ledger head" />
                  </dd>
                </>
              ) : null}
              {status ? (
                <>
                  <dt>status list</dt>
                  <dd>
                    index {status["statusListIndex"]} of{" "}
                    <a href={status["statusListCredential"]} target="_blank" rel="noreferrer">
                      the published list
                    </a>
                  </dd>
                </>
              ) : null}
            </dl>

            <div className="audit-toolbar" style={{ marginTop: 12 }}>
              <button type="button" className="primary" onClick={() => void verifySignature()}>
                Verify signature
              </button>
              <button type="button" onClick={() => setShowRaw((on) => !on)}>
                {showRaw ? "Hide claims" : "Show decoded claims"}
              </button>
              {check.state === "ok" ? <span className="pill ok">signature valid</span> : null}
              {check.state === "failed" ? <span className="pill fail">not verified</span> : null}
              {check.state === "checking" ? <span className="muted">resolving issuer DID...</span> : null}
            </div>

            {check.state === "ok" ? (
              <p className="muted" style={{ marginTop: 8 }}>
                Verified in this browser against {check.issuer}
              </p>
            ) : null}
            {check.state === "failed" ? (
              <p className="err" style={{ marginTop: 8 }}>
                {check.reason}
              </p>
            ) : null}

            {showRaw ? <pre className="raw">{JSON.stringify(decoded.payload, null, 2)}</pre> : null}
          </>
        ) : (
          <p className="muted">
            {trace && !credit
              ? "That task has decisions but no credential - it never reached issuance."
              : "Paste the task id from an issuance to pull evidence, decision and credential in one thread."}
          </p>
        )}
      </div>
    </section>
  );
};
