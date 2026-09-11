import { useState } from "react";
import { api } from "../api.ts";

/**
 * OWNER: Harsh
 *
 * The opening shot of the demo: real satellite burn detections on a map,
 * then one click that routes them to conversion units.
 *
 * BUILD
 *  - react-leaflet + OpenStreetMap tiles. No Mapbox, no account, no token.
 *  - burn detections as one marker layer, conversion units as another
 *  - after "Run matching", draw each match as a line lot -> unit, and show
 *    the rationale string from the match in the side panel
 *  - a small summary strip: lots listed, tonnes available, matched, total
 *    transport debit in kgCO2e
 *  - the page must look alive on first load with seeded data - never an
 *    empty map waiting for a click
 *
 * Leaflet needs its stylesheet. Import "leaflet/dist/leaflet.css" here.
 */
export const OperatorMap = () => {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const run = async (fn: () => Promise<unknown>, label: string) => {
    setBusy(true);
    setMsg(label + "...");
    try {
      await fn();
      setMsg(label + " done");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="view">
      <div className="view-head">
        <h1>Operator</h1>
        <p>Live burn detections, routed to the nearest conversion unit with capacity.</p>
      </div>
      <div className="row">
        <button disabled={busy} onClick={() => run(api.ingest, "Pull detections")}>
          Pull detections
        </button>
        <button disabled={busy} onClick={() => run(() => api.match({ maxRadiusKm: 60 }), "Run matching")}>
          Run matching
        </button>
        <span className="muted">{msg}</span>
      </div>
      <div className="placeholder">TODO(harsh): map + matches + summary strip</div>
    </div>
  );
};
