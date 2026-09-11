import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FeedstockClass, FieldEvidence, VerifyEvidenceOutput } from "@charkha/core";
import { api } from "../api.ts";
import { LANGUAGES, detectLang, rememberLang, translator, type Lang } from "../i18n.ts";
import { CLASSES, canaryTensor, topClass } from "../../../../agents/verifier/src/protocol.ts";
import { buildEvidence, newEvidenceId, type BatchForm, type Scored } from "./field/evidence.ts";
import { EvidenceQueue, type FlushReport } from "./field/queue.ts";
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

const FEEDSTOCKS: FeedstockClass[] = ["paddy_straw", "wheat_straw", "sugarcane_trash", "maize_stover", "mixed"];

const LABELS: Record<string, string> = { good_char: "Good char", poor_char: "Poor char", not_char: "Not char" };

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
  const [model, setModel] = useState<FieldModel | null>(null);
  const [modelErr, setModelErr] = useState("");
  const [gpuNote, setGpuNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [photoErr, setPhotoErr] = useState("");
  const [matchId, setMatchId] = useState(() => safeStorage().getItem("charkha.field.matchId") ?? "");
  const [batch, setBatch] = useState<BatchForm>({
    pyrolysisPeakTempC: "",
    residenceTimeMin: "",
    feedstock: "paddy_straw",
    outputTonnes: "",
    hcOrgRatio: "",
  });
  const [gps, setGps] = useState<Gps>({ lat: "", lon: "", source: "none" });
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [pending, setPending] = useState(() => queue.list().length);
  const [flushNote, setFlushNote] = useState("");
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

  const submit = async () => {
    if (!draft.body) return;
    const evidence = { ...draft.body, evidenceId: newEvidenceId() };
    safeStorage().setItem("charkha.field.matchId", evidence.matchId);
    setBusy(true);
    const res = await queue.submit(evidence, send);
    setBusy(false);
    setPending(queue.list().length);
    if (res.status === "sent") {
      const r = res.result as { taskId: string; output: VerifyEvidenceOutput };
      setOutcome({ kind: "verdict", taskId: r.taskId, output: r.output });
    } else if (res.status === "queued") {
      setOutcome({ kind: "queued", error: res.error });
    } else {
      setOutcome({ kind: "error", error: res.error });
    }
  };

  const top = photo ? topClass(photo.scored.photo) : null;
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
            read "Hindi" either. */}
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
          {busy ? "Working…" : photo ? "Retake photo" : "Take photo of the char"}
        </label>
        <canvas ref={canvas} hidden />
        {photoErr ? <p className="fc-error">{photoErr}</p> : null}
        {photo && top ? (
          <div className="fc-result">
            <img src={photo.url} alt="captured char, kept on this device" />
            <div className="fc-scores">
              <p className="fc-top">
                {LABELS[top.cls]} <span>{(top.p * 100).toFixed(1)}%</span>
              </p>
              {CLASSES.map((c) => (
                <div key={c} className="fc-bar">
                  <span>{LABELS[c]}</span>
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
          <label>
            Match id
            <input value={matchId} onChange={(e) => setMatchId(e.target.value)} placeholder="match_…" autoCapitalize="off" />
          </label>
          <label>
            Feedstock
            <select value={batch.feedstock} onChange={(e) => setBatch((b) => ({ ...b, feedstock: e.target.value as FeedstockClass }))}>
              {FEEDSTOCKS.map((f) => (
                <option key={f} value={f}>
                  {f.replace("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label>
            Peak temperature (°C)
            <input inputMode="decimal" {...field("pyrolysisPeakTempC")} placeholder="550" />
          </label>
          <label>
            Residence time (min)
            <input inputMode="decimal" {...field("residenceTimeMin")} placeholder="90" />
          </label>
          <label>
            Output biochar (t)
            <input inputMode="decimal" {...field("outputTonnes")} placeholder="2.5" />
          </label>
          <label>
            H/C<sub>org</sub> ratio (optional)
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
          <button className="fc-submit" disabled={!draft.body || busy} onClick={() => void submit()}>
            {t("Submit")}
          </button>
          {!draft.body ? <span className="muted">{draft.error}</span> : null}
        </div>

        {outcome?.kind === "queued" ? (
          <p className="fc-note warn">Could not reach the verifier - saved on this device, retrying automatically ({outcome.error}).</p>
        ) : null}
        {outcome?.kind === "error" ? <p className="fc-error">{outcome.error}</p> : null}
        {outcome?.kind === "verdict" ? (
          <div className={`fc-verdict ${outcome.output.verdict}`}>
            <p className="fc-top">{outcome.output.verdict.replace("_", " ")}</p>
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
            <p className="muted">
              task {outcome.taskId} · verified by model {outcome.output.modelVersion} ({short(outcome.output.modelHash)})
            </p>
          </div>
        ) : null}
      </section>
    </div>
  );
};
