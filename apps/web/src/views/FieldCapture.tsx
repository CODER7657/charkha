import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FeedstockClass, FieldEvidence, MatchSummary, VerifyEvidenceOutput } from "@charkha/core";
import { api } from "../api.ts";
import { LANGUAGES, detectLang, rememberLang, translator, type Lang } from "../i18n.ts";
/* One copy implementation, tested in audit.copy.test.ts. A second copy here
   would be a second thing to get wrong in the same way. */
import { copyText } from "./AuditConsole.tsx";
import { CLASSES, canaryTensor, topClass } from "../../../../agents/verifier/src/protocol.ts";
import { buildEvidence, newEvidenceId, type BatchForm, type Scored } from "./field/evidence.ts";
import { EvidenceQueue, type FlushReport } from "./field/queue.ts";
import {
  FEEDSTOCKS,
  lotFeedstockFromVerdict,
  photoAlreadySent,
  recallLotFeedstock,
  rememberLotFeedstock,
} from "./field/feedstock.ts";
import { imageToTensor, loadFieldModel, sha256Hex, type FieldModel } from "./field/runtime.ts";
import "./field/field.css";

/**
 * OWNER: Hem
 *
 * The privacy beat, and the one that must work with the wifi switched off.
 *
 * HARD RULE: the photo never leaves the device. It is hashed and classified
 * here with onnxruntime-web; the request body is built in field/evidence.ts
 * from { imageHash, modelHash, modelVersion, clientScores, gps, batch } and
 * nothing else. The exact body is shown on screen before submit.
 */

const LABELS: Record<string, string> = { good_char: "Good char", poor_char: "Poor char", not_char: "Not char" };
const VERDICT_LABEL: Record<string, string> = { accepted: "Accepted", rejected: "Rejected", needs_review: "Needs review" };

type Photo = { url: string; scored: Scored; ms: number; capturedAt: Date };
type Gps = { lat: string; lon: string; source: "device" | "manual" | "none" };
type Outcome =
  | { kind: "verdict"; taskId: string; output: VerifyEvidenceOutput }
  | { kind: "queued"; error: string }
  | { kind: "error"; error: string };

const memoryStore = (): Pick<Storage, "getItem" | "setItem"> => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};

const safeStorage = (): Pick<Storage, "getItem" | "setItem"> => {
  try {
    localStorage.setItem("charkha.probe", "1");
    return localStorage;
  } catch {
    return memoryStore();
  }
};

const queue = new EvidenceQueue(safeStorage());
const send = (e: FieldEvidence) => api.submitEvidence(e) as Promise<{ taskId: string; output: VerifyEvidenceOutput }>;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

export const FieldCapture = () => {
  /* The users this screen is for are standing in a field in Punjab or
     Haryana. English-only here is not a missing nicety, it is the product
     not working for the people it is for. */
  const [lang, setLang] = useState<Lang>(detectLang);
  const t = useMemo(() => translator(lang), [lang]);

  /* Loaded once, not polled: a farmer picks a batch and gets on with it, and
     a list that reshuffles under a thumb is worse than a stale one. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/matches", { headers: { "content-type": "application/json" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { output?: { matches?: MatchSummary[] } };
        if (!cancelled) setChoices(body.output?.matches ?? []);
      } catch (e) {
        /* Offline is the normal case in a field, and the typed id still works.
           Say why the picker is missing rather than rendering an empty list
           that reads as "there are no batches". */
        if (!cancelled) setChoicesErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const [model, setModel] = useState<FieldModel | null>(null);
  const [modelErr, setModelErr] = useState("");
  const [gpuNote, setGpuNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [photoErr, setPhotoErr] = useState("");
  const [matchId, setMatchId] = useState(() => safeStorage().getItem("charkha.field.matchId") ?? "");
  /* The batches this phone could be standing in front of.
     Field capture used to ask for a matchId and offer no way to get one: a
     free-text box with a `match_...` placeholder. The only place a real id
     ever appeared was the Operator result panel, and that is empty once a
     round has spent the day's capacity - so on any day but the first, there
     was no route from "I have a char pile" to the id this form demands. */
  const [choices, setChoices] = useState<MatchSummary[] | null>(null);
  const [choicesErr, setChoicesErr] = useState("");
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle");

  const [batch, setBatch] = useState<BatchForm>({
    pyrolysisPeakTempC: "",
    residenceTimeMin: "",
    feedstock: "paddy_straw",
    outputTonnes: "",
    hcOrgRatio: "",
  });
  const [gps, setGps] = useState<Gps>({ lat: "", lon: "", source: "none" });
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  /* The photo this device has already handed to the verifier. One image hash
     is one evidence row server-side, so a second send of it can only be
     refused - we say so here rather than letting it look like fraud. */
  const [sentImageHash, setSentImageHash] = useState<string | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [pending, setPending] = useState(() => queue.list().length);
  const [flushNote, setFlushNote] = useState("");
  /* What the lot said for this match, learned from a previous verdict:
     nothing exposes matchId -> lot, so the first attempt cannot know. */
  const [lotFeedstock, setLotFeedstock] = useState<FeedstockClass | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  /* ---- model: load once, while we still have network ---- */
  useEffect(() => {
    let live = true;
    loadFieldModel()
      .then((m) => {
        if (!live) return;
        setModel(m);
        if (m.fallbacks.length) setGpuNote(`${m.fallbacks[0]!.slice(0, 120)} - using ${m.backend}`);
      })
      .catch((e: unknown) => live && setModelErr(errText(e)));
    return () => {
      live = false;
    };
  }, []);

  /* ---- offline queue: retry when the network comes back, and on a timer ---- */
  const flush = useCallback(async () => {
    if (queue.list().length === 0) return;
    const report: FlushReport = await queue.flush(send);
    setPending(queue.list().length);
    if (report.sent.length) setFlushNote(`${report.sent.length} queued submission(s) delivered`);
    if (report.failed.length) setFlushNote(`queued submission refused by server: ${report.failed[0]!.error}`);
  }, []);

  useEffect(() => {
    const up = () => {
      setOnline(true);
      void flush();
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    const t = setInterval(() => void flush(), 15_000);
    void flush();
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      clearInterval(t);
    };
  }, [flush]);

  /* ---- GPS ---- */
  const locate = useCallback(() => {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setGps({ lat: p.coords.latitude.toFixed(6), lon: p.coords.longitude.toFixed(6), source: "device" }),
      () => setGps((g) => ({ ...g, source: g.lat ? g.source : "manual" })),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }, []);
  useEffect(locate, [locate]);

  useEffect(() => {
    const known = recallLotFeedstock(safeStorage(), matchId);
    setLotFeedstock(known);
    if (known) setBatch((b) => (b.feedstock === known ? b : { ...b, feedstock: known }));
  }, [matchId]);

  /* ---- capture: hash + classify, all on device ---- */
  const onFile = async (file: File | undefined) => {
    if (!file || !model || !canvas.current) return;
    setBusy(true);
    setPhotoErr("");
    setOutcome(null);
    try {
      const capturedAt = new Date();
      const imageHash = await sha256Hex(await file.arrayBuffer());
      const t0 = performance.now();
      const tensor = await imageToTensor(file, canvas.current);
      const photoScores = await model.run(tensor);
      const ms = Math.round(performance.now() - t0);
      const canary = await model.run(canaryTensor(imageHash));
      if (photo) URL.revokeObjectURL(photo.url);
      setPhoto({
        url: URL.createObjectURL(file), // local blob: URL, never uploaded
        ms,
        capturedAt,
        scored: { imageHash, modelHash: model.hash, modelVersion: model.version, photo: photoScores, canary },
      });
    } catch (e) {
      setPhotoErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  /* ---- the body we would send, shown before submit ---- */
  const draft = useMemo((): { body: FieldEvidence | null; error: string } => {
    if (!photo) return { body: null, error: "take a photo first" };
    const lat = Number(gps.lat);
    const lon = Number(gps.lon);
    if (gps.lat === "" || gps.lon === "" || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      return { body: null, error: "location is required" };
    }
    try {
      return {
        body: buildEvidence({
          evidenceId: "(assigned on submit)",
          matchId,
          at: { lat, lon },
          capturedAt: photo.capturedAt,
          scored: photo.scored,
          batch,
        }),
        error: "",
      };
    } catch (e) {
      return { body: null, error: errText(e) };
    }
  }, [photo, gps, matchId, batch]);

  /* Correcting a mismatch needs a NEW photograph. The verifier keeps one
     evidence row per image hash (#46), so resending these bytes under a fresh
     evidence id is refused as a double-count - and that refusal is a 400, which
     the queue drops. Carry the lot's feedstock over and drop the photo: the
     operator is standing at the char, so a retake is one tap. */
  const retakeWith = (feedstock: FeedstockClass) => {
    setBatch((b) => ({ ...b, feedstock }));
    setLotFeedstock(feedstock);
    setPhoto(null);
    setOutcome(null);
  };

  const submit = async (feedstock?: FeedstockClass) => {
    if (!draft.body) return;
    /* Belt and braces - Submit is already disabled for a spent photo. Return
       without touching `outcome`: setting an error here replaced the verdict,
       and the recovery button only renders inside the verdict block, so a
       second tap silently destroyed the way back. Found on a real device. */
    if (photoAlreadySent(sentImageHash, draft.body.imageHash)) return;
    const body = feedstock ? { ...draft.body, batch: { ...draft.body.batch, feedstock } } : draft.body;
    const evidence = { ...body, evidenceId: newEvidenceId() };
    safeStorage().setItem("charkha.field.matchId", evidence.matchId);
    setBusy(true);
    const res = await queue.submit(evidence, send);
    setBusy(false);
    setPending(queue.list().length);
    if (res.status === "sent") {
      const r = res.result as { taskId: string; output: VerifyEvidenceOutput };
      setSentImageHash(evidence.imageHash);
      setOutcome({ kind: "verdict", taskId: r.taskId, output: r.output });
      /* The verdict is the only place the lot's feedstock is visible, so
         keep it: this match then starts from the right value. */
      const said = lotFeedstockFromVerdict(r.output) ?? (r.output.verdict === "accepted" ? evidence.batch.feedstock : null);
      if (said) {
        setLotFeedstock(said);
        rememberLotFeedstock(safeStorage(), evidence.matchId, said);
      }
    } else if (res.status === "queued") {
      /* Queued still counts as spent: the flush will deliver this photo, and a
         second copy of it would only be refused when the network returns. */
      setSentImageHash(evidence.imageHash);
      setOutcome({ kind: "queued", error: res.error });
    } else {
      setOutcome({ kind: "error", error: res.error });
    }
  };

  const top = photo ? topClass(photo.scored.photo) : null;
  /* This exact photograph has already gone to the verifier. One image hash is
     one evidence row, so sending it again can only be refused - say so beside
     the button rather than letting them tap into a double-count refusal.
     Derived, not stored: a new photo is a new hash, so it clears itself. */
  const photoSpent = Boolean(draft.body) && photoAlreadySent(sentImageHash, draft.body!.imageHash);
  const field = (key: keyof BatchForm) => ({
    value: batch[key],
    onChange: (e: { target: { value: string } }) => setBatch((b) => ({ ...b, [key]: e.target.value })),
  });

  return (
    <div className="view field">
      <div className="view-head fc-head">
        <div>
          <h1>{t("Field capture")}</h1>
          <p>
            {t(
              "Inference runs on this device. The photo is never uploaded, only its hash and the scores.",
            )}
          </p>
        </div>
        {/* Native names only. Someone who cannot read the English label cannot
            read "Hindi" either. Labelled and sized as a primary control -
            buried in a corner it may as well not exist for the user it is for. */}
        <div className="fc-langwrap">
          <span className="fc-langlabel">भाषा / ਭਾਸ਼ਾ / ભાષા / Language</span>
          <div className="fc-lang" role="group" aria-label="Language">
            {LANGUAGES.map((l) => (
              <button
                key={l.code}
                type="button"
                lang={l.code}
                className={l.code === lang ? "on" : ""}
                aria-pressed={l.code === lang}
                onClick={() => {
                  setLang(l.code);
                  rememberLang(l.code);
                }}
              >
                {l.native}
              </button>
            ))}
          </div>
        </div>
      </div>

      <section className="fc-status" aria-live="polite">
        <div>
          <span className={online ? "fc-pill ok" : "fc-pill off"}>{online ? t("Online") : t("Offline")}</span>
          {model ? <span className="fc-pill ok">{model.backend === "webgpu" ? "WebGPU" : "wasm"}</span> : null}
          {pending ? (
            <button className="fc-pill warn" onClick={() => void flush()}>
              {pending} {t("Waiting to send")}
            </button>
          ) : null}
        </div>
        <p className="muted">
          {modelErr
            ? `model failed to load: ${modelErr}`
            : model
              ? `model ${model.version} · sha256 ${short(model.hash)}`
              : t("Loading model")}
        </p>
        {gpuNote ? <p className="muted">{gpuNote}</p> : null}
        {flushNote ? <p className="muted">{flushNote}</p> : null}
      </section>

      <section className="fc-card">
        <h2>1 · Photo</h2>
        <label className={model && !busy ? "fc-capture" : "fc-capture disabled"}>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            disabled={!model || busy}
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {busy ? "…" : photo ? t("Retake") : t("Take photo")}
        </label>
        <canvas ref={canvas} hidden />
        {photoErr ? <p className="fc-error">{photoErr}</p> : null}
        {photo && top ? (
          <div className="fc-result">
            <img src={photo.url} alt="captured char, kept on this device" />
            <div className="fc-scores">
              <p className="fc-top">
                {t(LABELS[top.cls]!)} <span>{(top.p * 100).toFixed(1)}%</span>
              </p>
              {CLASSES.map((c) => (
                <div key={c} className="fc-bar">
                  <span>{t(LABELS[c]!)}</span>
                  <meter min={0} max={1} value={photo.scored.photo[c]} />
                  <span className="num">{(photo.scored.photo[c] * 100).toFixed(1)}%</span>
                </div>
              ))}
              <p className="muted">
                {photo.ms} ms on {model?.backend} · image sha256 {short(photo.scored.imageHash)}
              </p>
              <p className="muted">model sha256 {short(photo.scored.modelHash)}</p>
            </div>
          </div>
        ) : null}
      </section>

      <section className="fc-card">
        <h2>2 · Batch</h2>
        <div className="fc-grid">
          <label className="fc-wide">
            {t("Which batch is this?")}
            {/* Say how many, so "are these all of them?" has an answer on
                screen. The skill caps at 25; at the cap there may be more. */}
            {choices && choices.length > 0 ? (
              <span className="fc-hint">
                {choices.length >= 25
                  ? t("25 most recent batches awaiting a photo")
                  : `${choices.length} ${t("batches awaiting a photo")}`}
              </span>
            ) : null}
            {/* Pick, do not type. Nobody recognises a batch by its id - they
                recognise the unit and the district, which is what this shows.
                The text box stays underneath for a typed or remembered id. */}
            {choices === null && !choicesErr ? (
              <span className="fc-hint">{t("Loading your batches")}</span>
            ) : choicesErr ? (
              <span className="fc-hint">{t("Could not load batches - type the ID below")}</span>
            ) : (choices?.length ?? 0) === 0 ? (
              <span className="fc-hint">{t("No batches are waiting for a photo")}</span>
            ) : (
              <div className="fc-picks">
                {(choices ?? []).map((m) => (
                  <button
                    type="button"
                    key={m.matchId}
                    className={m.matchId === matchId ? "fc-pick on" : "fc-pick"}
                    aria-pressed={m.matchId === matchId}
                    onClick={() => {
                      setMatchId(m.matchId);
                      /* The lot already knows its feedstock, and a mismatch is
                         refused by the methodology check - so fill it in
                         rather than letting someone guess it wrong. */
                      setBatch((b) => ({ ...b, feedstock: m.feedstock }));
                    }}
                  >
                    <b>{m.unitName}</b>
                    {/* Distance, not district, is the reliable recogniser now
                        that the feed covers India: districtFor() only knows
                        Punjab and Haryana, so on the deployed host twenty of
                        twenty-five rows read "district unknown" - which
                        distinguishes nothing. The haul is always known, and
                        "31 km" is what a driver actually recognises. */}
                    <span>
                      {m.district ? `${m.district} · ` : ""}
                      {m.distanceKm.toFixed(0)} km · {m.assignedTonnes.toFixed(1)} t · {t(m.feedstock)}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className="fc-matchid-row">
              <input
                className="fc-matchid"
                value={matchId}
                onChange={(e) => setMatchId(e.target.value)}
                placeholder={t("or paste a match ID")}
                autoCapitalize="off"
                aria-label={t("Match ID")}
              />
              {/* The id is what a field worker reads back to an operator, or
                  pastes into Audit. Hunting for it inside a text input is not
                  that, and on a phone a long value scrolls out of sight. */}
              {matchId ? (
                <button
                  type="button"
                  className="fc-copy"
                  aria-label={`${t("Copy")} ${matchId}`}
                  title={matchId}
                  onClick={() => {
                    void copyText(matchId).then((ok) => {
                      setCopied(ok ? "ok" : "fail");
                      setTimeout(() => setCopied("idle"), 1600);
                    });
                  }}
                >
                  {copied === "ok" ? t("Copied") : copied === "fail" ? t("Select it") : t("Copy")}
                </button>
              ) : null}
            </div>
          </label>
          <label>
            {t("Feedstock")}
            <select value={batch.feedstock} onChange={(e) => setBatch((b) => ({ ...b, feedstock: e.target.value as FeedstockClass }))}>
              {FEEDSTOCKS.map((f) => (
                <option key={f} value={f}>
                  {t(f)}
                </option>
              ))}
            </select>
            {lotFeedstock ? (
              <span className="fc-hint">
                {t("Lot says")}: {t(lotFeedstock)}
              </span>
            ) : null}
          </label>
          <label>
            {t("Peak temperature")} (°C)
            <input inputMode="decimal" {...field("pyrolysisPeakTempC")} placeholder="550" />
          </label>
          <label>
            {t("Residence time")} ({t("minutes")})
            <input inputMode="decimal" {...field("residenceTimeMin")} placeholder="90" />
          </label>
          <label>
            {t("Output tonnes")}
            <input inputMode="decimal" {...field("outputTonnes")} placeholder="2.5" />
          </label>
          <label>
            {t("H/C ratio")} ({t("optional")})
            <input inputMode="decimal" {...field("hcOrgRatio")} placeholder="lab result" />
          </label>
          <label>
            {t("Latitude")}
            <input inputMode="decimal" value={gps.lat} onChange={(e) => setGps((g) => ({ ...g, lat: e.target.value, source: "manual" }))} />
          </label>
          <label>
            {t("Longitude")}
            <input inputMode="decimal" value={gps.lon} onChange={(e) => setGps((g) => ({ ...g, lon: e.target.value, source: "manual" }))} />
          </label>
        </div>
        <div className="row">
          <button onClick={locate}>{t("Use device location")}</button>
          <span className="muted">{gps.source === "device" ? "from device GPS" : gps.source === "manual" ? "entered by hand" : ""}</span>
        </div>
      </section>

      <section className="fc-card">
        <h2>3 · Submit</h2>
        <details>
          <summary>
            {t("This is what leaves your phone")}
            {draft.body ? ` · ${new Blob([JSON.stringify(draft.body)]).size} bytes, no image` : ""}
          </summary>
          <pre>{draft.body ? JSON.stringify(draft.body, null, 2) : draft.error}</pre>
        </details>
        <div className="row">
          <button className="fc-submit" disabled={!draft.body || busy || photoSpent} onClick={() => void submit()}>
            {t("Submit")}
          </button>
          {!draft.body ? <span className="muted">{draft.error}</span> : null}
          {/* Not an error, and it used to be styled as one - red text beside a
              green "Accepted" panel, which reads as a failure at the exact
              moment the thing succeeded. It is the one-photo-one-credit rule
              doing its job, and it needs to say what to do next. */}
          {photoSpent ? (
            <span className="fc-spent">{t("Sent. Take a new photo for the next batch.")}</span>
          ) : null}
        </div>

        {outcome?.kind === "queued" ? (
          <p className="fc-note warn">Could not reach the verifier - saved on this device, retrying automatically ({outcome.error}).</p>
        ) : null}
        {outcome?.kind === "error" ? <p className="fc-error">{outcome.error}</p> : null}
        {outcome?.kind === "verdict" ? (
          <div className={`fc-verdict ${outcome.output.verdict}`}>
            <p className="fc-top">{t(VERDICT_LABEL[outcome.output.verdict] ?? outcome.output.verdict)}</p>
            <ul>
              {outcome.output.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <ul className="fc-checks">
              {outcome.output.methodologyChecks.map((c) => (
                <li key={c.check} className={c.passed ? "pass" : "fail"}>
                  <b>{c.passed ? "✓" : "✗"}</b> {c.check.replaceAll("_", " ")} <span className="muted">{c.detail}</span>
                </li>
              ))}
            </ul>
            {lotFeedstockFromVerdict(outcome.output) && !busy ? (
              /* Refused only because the feedstock disagreed with the lot. We
                 now know what the lot says, so fill it in and ask for a fresh
                 shot - the same bytes can never be sent twice. */
              <button
                className="fc-submit"
                onClick={() => retakeWith(lotFeedstockFromVerdict(outcome.output)!)}
              >
                {t("Retake with the lot\u2019s feedstock")}
              </button>
            ) : null}
            <p className="muted">
              task {outcome.taskId} · verified by model {outcome.output.modelVersion} ({short(outcome.output.modelHash)})
            </p>
          </div>
        ) : null}
      </section>
    </div>
  );
};
