import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

/** What the PUBLISHED list says, which is a different question from what our database says. */
type StatusCheck =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "ok"; revoked: boolean; index: number; listIssuer: string; origin: string; foreign: boolean }
  | { state: "failed"; reason: string };

/**
 * Read one bit out of a Bitstring Status List.
 *
 * The list is a gzipped bitstring, base64url encoded. Bit 0 is the HIGH bit of
 * byte 0 - get that backwards and every answer is wrong but plausible.
 */
const bitAt = (bytes: Uint8Array, index: number): number => {
  const byte = bytes[index >>> 3];
  if (byte === undefined) throw new Error(`index ${index} is past the end of the list`);
  return (byte >>> (7 - (index & 7))) & 1;
};

/** gzip, in the browser, with no dependency. */
const gunzip = async (data: Uint8Array): Promise<Uint8Array> => {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

export const AuditConsole = () => {
  const [chain, setChain] = useState<DecisionRecord[]>([]);
  const [pristine, setPristine] = useState<DecisionRecord[]>([]);
  const [serverSaid, setServerSaid] = useState<boolean | null>(null);
  const [verdict, setVerdict] = useState<ChainVerdict | null>(null);
  const [tamperMode, setTamperMode] = useState(false);
  /* A decision row can send its task id to the credential panel below.
     Before this the panel was the only way in and the log showed no task id
     at all - so the only thing to paste was a TRUNCATED hash copied off the
     screen, which 404s. The counter forces a re-run when the same row is
     pressed twice. */
  const [seed, setSeed] = useState<{ taskId: string; n: number } | null>(null);
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
                    {/* The log never showed a task id, so the only thing a
                        reader could paste into the panel below was a truncated
                        hash - which 404s. This sends the full id. */}
                    <button
                      type="button"
                      className="trace-row"
                      title={`Trace ${rec.taskId}`}
                      onClick={() => setSeed({ taskId: rec.taskId, n: Date.now() })}
                    >
                      trace
                    </button>
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

        <CredentialPanel seed={seed} />
      </div>
    </div>
  );
};

/**
 * Why a trace lookup failed, in words a reader can act on.
 *
 * It used to render the raw failure - `/trace/f7654afa%E2%80%A6bc7 -> HTTP 404`
 * - which names the symptom and none of the three real causes:
 *
 *  1. a truncated id copied off the screen. The decision log abbreviates every
 *     hash, so the obvious thing to paste is exactly the thing that cannot work.
 *  2. a task id from a READ. listLots and listUnits never call appendDecision,
 *     so a Saathi hop shows a perfectly real task id that the ledger has never
 *     heard of. Nothing said so.
 *  3. a genuinely unknown id.
 *
 * The shape of the id tells us which, so say which.
 */
export const explainTraceFailure = (id: string, err: unknown): string => {
  const raw = err instanceof Error ? err.message : String(err);
  if (!/404/.test(raw)) return raw;
  if (/[.…]{2,}|…/.test(id)) {
    return "That looks like a shortened id copied off the screen. Press Trace on a decision row instead - it sends the full id.";
  }
  return "No decisions were recorded against that task id. Reads - listing lots, listing units, most Saathi answers - do not write to the ledger, so their task ids cannot be traced. Press Trace on a row in the decision log.";
};

/* ------------------------------------------------------------------ *
 * Credential panel: paste a task id, get the credential, check the
 * signature against the issuer DID resolved in this browser.
 * ------------------------------------------------------------------ */

const CredentialPanel = ({ seed }: { seed: { taskId: string; n: number } | null }) => {
  const panelRef = useRef<HTMLElement | null>(null);
  const [taskId, setTaskId] = useState("");
  const [trace, setTrace] = useState<TraceBundle | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<SignatureCheck>({ state: "idle" });
  const [listCheck, setListCheck] = useState<StatusCheck>({ state: "idle" });
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

  const lookup = useCallback(async (explicit?: string) => {
    const id = (explicit ?? taskId).trim();
    if (!id) return;
    setBusy(true);
    setErr("");
    setCheck({ state: "idle" });
    setListCheck({ state: "idle" });
    try {
      setTrace((await api.trace(id)) as TraceBundle);
    } catch (e) {
      setTrace(null);
      setErr(explainTraceFailure(id, e));
    } finally {
      setBusy(false);
    }
  }, [taskId]);

  /* A Trace button on a decision row seeds this panel. Re-runs on the counter
     so pressing the same row twice works. */
  useEffect(() => {
    if (!seed) return;
    setTaskId(seed.taskId);
    void lookup(seed.taskId);
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    /* Deliberately only `seed`. `lookup` is recreated on every keystroke in
       the box, so depending on it would re-run the trace while someone is
       still typing - and `seed` carries its own counter for repeats. */
  }, [seed]);

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

  /**
   * Revocation, checked the way a holder would.
   *
   * Fetch the published list, verify the LIST's own signature against the
   * issuer DID, then read the single bit this credential names. Our database
   * is not consulted - that is the whole point. A holder has the credential
   * and the list, and nothing else.
   */
  const checkStatusList = async () => {
    if (!statusEntry) return;
    setListCheck({ state: "checking" });
    try {
      const url = statusEntry["statusListCredential"];
      if (!url) throw new Error("the credential names no status list");
      const index = Number(statusEntry["statusListIndex"]);
      if (!Number.isInteger(index) || index < 0) throw new Error(`credential names a bad index: ${String(statusEntry["statusListIndex"])}`);

      /* Fetch exactly what the credential names. If it points somewhere else,
         say so - a credential naming a list we cannot reach is not verifiable,
         and quietly substituting a URL that works would verify a different
         document than the one this credential commits to. */
      const named = new URL(url, window.location.href);
      const foreign = named.origin !== window.location.origin;

      const res = await fetch(named.href).catch(() => null);
      if (!res)
        throw new Error(
          foreign
            ? `the list this credential names is at ${named.origin}, which this page cannot reach`
            : "the published list could not be reached",
        );
      if (!res.ok) throw new Error(`the list this credential names answered HTTP ${res.status} (${named.origin})`);

      const listJwt = (await res.text()).trim();

      /* A 200 is not an answer. This exact path returned the SPA's index.html
         with a 200 for a day, and anything that treats a success code as proof
         would have shown a green tick over a web page. */
      const looksLikeJwt = /^[\w-]+\.[\w-]+\.[\w-]+$/.test(listJwt);
      if (!looksLikeJwt)
        throw new Error(
          foreign
            ? `${named.origin} did not answer with a credential - the list this credential names is not served there`
            : "the published list did not answer with a credential",
        );

      const [{ verifyCredential }, { Resolver }, keyDidResolver] = await Promise.all([
        import("did-jwt-vc"),
        import("did-resolver"),
        import("key-did-resolver"),
      ]);
      type Registry = ConstructorParameters<typeof Resolver>[0];
      const resolver = new Resolver(keyDidResolver.getResolver() as Registry);

      // The list is signed too, so it cannot be swapped in transit.
      const verified = await verifyCredential(listJwt, resolver);
      if (!verified.verified) throw new Error("the published list did not verify");

      const subject = (verified.verifiableCredential as { credentialSubject?: Record<string, unknown> })
        .credentialSubject;
      const encoded = String(subject?.["encodedList"] ?? "");
      if (!encoded) throw new Error("the list carries no encodedList");

      const packed = Uint8Array.from(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));
      const bits = await gunzip(packed);

      setListCheck({
        state: "ok",
        revoked: bitAt(bits, index) === 1,
        index,
        listIssuer: String(verified.issuer),
        origin: named.origin,
        foreign,
      });
    } catch (e) {
      setListCheck({ state: "failed", reason: e instanceof Error ? e.message : String(e) });
    }
  };

  const subject = (decoded?.payload["vc"] as { credentialSubject?: Record<string, Record<string, unknown>> } | undefined)
    ?.credentialSubject;
  const statusEntry = (decoded?.payload["vc"] as { credentialStatus?: Record<string, string> } | undefined)
    ?.credentialStatus;

  return (
    <section className="card" ref={panelRef}>
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
              {statusEntry ? (
                <>
                  <dt>status list</dt>
                  <dd>
                    index {statusEntry["statusListIndex"]} of{" "}
                    <a href={statusEntry["statusListCredential"]} target="_blank" rel="noreferrer">
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
              <button type="button" onClick={() => void checkStatusList()} disabled={!statusEntry}>
                Check the published list
              </button>
              <button type="button" onClick={() => setShowRaw((on) => !on)}>
                {showRaw ? "Hide claims" : "Show decoded claims"}
              </button>
              {check.state === "ok" ? <span className="pill ok">signature valid</span> : null}
              {check.state === "failed" ? <span className="pill fail">not verified</span> : null}
              {check.state === "checking" ? <span className="muted">resolving issuer DID...</span> : null}
              {listCheck.state === "ok" ? (
                <span className={listCheck.revoked ? "pill retired" : "pill ok"}>
                  {listCheck.revoked ? "revoked per the list" : "live per the list"}
                </span>
              ) : null}
              {listCheck.state === "checking" ? <span className="muted">fetching the published list...</span> : null}
            </div>

            {listCheck.state === "ok" ? (
              <p className="muted" style={{ marginTop: 8 }}>
                Bit {listCheck.index} of the list at {listCheck.origin}, read in this browser. Signed by{" "}
                {listCheck.listIssuer} and verified before the bit was read — our database was not asked.
                {listCheck.foreign ? " This credential names a list on another origin; it was fetched from there, not from here." : ""}
              </p>
            ) : null}
            {listCheck.state === "failed" ? (
              <p className="err" style={{ marginTop: 8 }}>
                Could not check the published list: {listCheck.reason}
              </p>
            ) : null}

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
