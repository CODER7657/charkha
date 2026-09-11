import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer } from "react-leaflet";
import L from "leaflet";
import type { ConversionUnit, Match, ResidueLot } from "@charkha/core";
import "leaflet/dist/leaflet.css";
import "./OperatorMap.css";

/**
 * OWNER: Harsh
 *
 * The opening shot of the demo: real satellite burn detections on a map,
 * then one click that routes them to conversion units.
 *
 * OpenStreetMap tiles through react-leaflet. No Mapbox: no account, no
 * token, and nothing identifying our users going to a vendor.
 *
 * The page loads itself. If the database has no lots yet it runs one ingest
 * on mount, which is safe to do because ingest dedupes on a stable detection
 * id - so a refresh cannot double the map.
 */

/** Punjab/Haryana residue belt - the bbox the producer pulls. */
const BELT_CENTRE: [number, number] = [30.42, 75.95];
const BELT_ZOOM = 8;

/** Matches RunMatchingInput's default. A lot further than this off the road
    network costs more in diesel than the residue is worth collecting. */
const MAX_RADIUS_KM = 60;

type Envelope<T> = { taskId?: string; output: T };

const get = async <T,>(path: string): Promise<T> => {
  const res = await fetch(`/api${path}`, { headers: { "content-type": "application/json" } });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return (await res.json()) as T;
};

const post = async <T,>(path: string, body: unknown): Promise<T> => {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return (await res.json()) as T;
};

const unitIcon = L.divIcon({
  className: "",
  // A square, so a unit is not just "the green one" - shape carries identity
  // as well as hue, which is what keeps the map readable for a colourblind
  // viewer and in a washed-out projector.
  html: '<span class="unit-pin"></span>',
  iconSize: [11, 11],
  iconAnchor: [6, 6],
});

const nf = new Intl.NumberFormat("en-IN");
const n1 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });

const Stat = ({ label, value, unit }: { label: string; value: string; unit?: string }) => (
  <div className="stat">
    <div className="stat-label">{label}</div>
    <div className="stat-value">
      {value}
      {unit ? <span className="stat-unit">{unit}</span> : null}
    </div>
  </div>
);

export const OperatorMap = () => {
  const [lots, setLots] = useState<ResidueLot[]>([]);
  const [units, setUnits] = useState<ConversionUnit[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [unitsMissing, setUnitsMissing] = useState(false);

  const loadLots = useCallback(async () => {
    const res = await get<Envelope<{ lots: ResidueLot[] }>>("/lots");
    const next = res.output?.lots ?? [];
    setLots(next);
    return next;
  }, []);

  const loadUnits = useCallback(async () => {
    try {
      const res = await get<Envelope<{ units: ConversionUnit[] }>>("/units");
      setUnits(res.output?.units ?? []);
      setUnitsMissing(false);
    } catch {
      // The gateway may not expose units yet. Degrade to a burns-only map
      // and say so rather than rendering a silently half-drawn picture.
      setUnits([]);
      setUnitsMissing(true);
    }
  }, []);

  const ingest = useCallback(async () => {
    const res = await post<Envelope<{ lotsCreated: number }>>("/ingest", {});
    await loadLots();
    return res;
  }, [loadLots]);

  /* Look alive on first load: draw what is already there, and if the table
     is empty, pull once so the demo never opens on a blank map. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setBusy(true);
      try {
        await loadUnits();
        const existing = await loadLots();
        if (!cancelled && existing.length === 0) {
          setMsg("No lots yet - pulling detections");
          await ingest();
        }
        if (!cancelled) setMsg("");
      } catch (e) {
        if (!cancelled) setMsg(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ingest, loadLots, loadUnits]);

  /** Runs an action, and reports either what it did or why it could not. */
  const run = async (fn: () => Promise<string>, label: string) => {
    setBusy(true);
    setMsg(`${label}...`);
    try {
      setMsg(await fn());
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onIngest = () =>
    run(async () => {
      const created = (await ingest()).output?.lotsCreated ?? 0;
      return created === 0 ? "No new detections" : `${created} new lots`;
    }, "Pull detections");

  const onMatch = () =>
    run(async () => {
      const res = await post<Envelope<{ matches: Match[]; unmatchedLotIds: string[] }>>("/match", {
        maxRadiusKm: MAX_RADIUS_KM,
      });
      const next = res.output?.matches ?? [];
      const unplaced = res.output?.unmatchedLotIds ?? [];
      setMatches(next);
      setUnmatched(unplaced);
      setSelected(next[0]?.matchId ?? null);
      await loadLots();
      return `${next.length} matched, ${unplaced.length} unplaced`;
    }, "Run matching");

  const lotById = useMemo(() => new Map(lots.map((l) => [l.lotId, l])), [lots]);
  const unitById = useMemo(() => new Map(units.map((u) => [u.unitId, u])), [units]);

  const lines = useMemo(
    () =>
      matches.flatMap((m) => {
        const lot = lotById.get(m.lotId);
        const unit = unitById.get(m.unitId);
        if (!lot || !unit) return [];
        return [{ match: m, from: [lot.at.lat, lot.at.lon] as [number, number], to: [unit.at.lat, unit.at.lon] as [number, number] }];
      }),
    [matches, lotById, unitById],
  );

  const totals = useMemo(
    () => ({
      lots: lots.length,
      tonnes: lots.reduce((sum, l) => sum + l.tonnes, 0),
      matched: matches.length,
      debit: matches.reduce((sum, m) => sum + m.transportKgCo2e, 0),
    }),
    [lots, matches],
  );

  const active = matches.find((m) => m.matchId === selected) ?? null;
  const activeLot = active ? lotById.get(active.lotId) : undefined;
  const activeUnit = active ? unitById.get(active.unitId) : undefined;

  return (
    <div className="view operator">
      <div className="view-head">
        <h1>Operator</h1>
        <p>Live burn detections, routed to the nearest conversion unit with capacity.</p>
      </div>

      <div className="row">
        <button disabled={busy} onClick={onIngest}>
          Pull detections
        </button>
        <button disabled={busy} onClick={onMatch}>
          Run matching
        </button>
        <span className="muted">{msg}</span>
      </div>

      <div className="strip">
        <Stat label="Lots listed" value={nf.format(totals.lots)} />
        <Stat label="Tonnes available" value={n1.format(totals.tonnes)} unit="t" />
        <Stat label="Matched" value={nf.format(totals.matched)} unit={unmatched.length > 0 ? `of ${totals.lots}` : undefined} />
        <Stat label="Transport debit" value={n1.format(totals.debit)} unit="kgCO₂e" />
      </div>

      {unitsMissing ? (
        <p className="origin warn">
          Conversion units are not being served by the gateway yet, so the map shows detections only.
        </p>
      ) : null}

      <div className="board">
        <div className="map-wrap">
          {/* Wheel zoom off on purpose: the map is taller than most laptop
              viewports, so a wheel that zoomed would swallow every attempt to
              scroll the page and drop the demo out over Rajasthan. The +/-
              control and double-click still zoom. */}
          <MapContainer center={BELT_CENTRE} zoom={BELT_ZOOM} scrollWheelZoom={false}>
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              maxZoom={18}
            />

            {lots.map((lot) => (
              <CircleMarker
                key={lot.lotId}
                center={[lot.at.lat, lot.at.lon]}
                radius={5}
                pathOptions={{ color: "#ff7038", weight: 1, fillColor: "#ff7038", fillOpacity: 0.75 }}
              >
                <Popup>
                  <b>{n1.format(lot.tonnes)} t</b> {lot.feedstock.replace(/_/g, " ")}
                  <br />
                  {lot.district ?? "district unknown"} · {lot.status}
                  <br />
                  {new Date(lot.availableFrom).toUTCString()}
                </Popup>
              </CircleMarker>
            ))}

            {units.map((unit) => (
              <Marker key={unit.unitId} position={[unit.at.lat, unit.at.lon]} icon={unitIcon}>
                <Popup>
                  <b>{unit.name}</b>
                  <br />
                  {n1.format(unit.capacityTonnesPerDay)} t/day
                  <br />
                  accepts {unit.accepts.map((a) => a.replace(/_/g, " ")).join(", ")}
                </Popup>
              </Marker>
            ))}

            {lines.map(({ match, from, to }) => (
              <Polyline
                key={match.matchId}
                positions={[from, to]}
                pathOptions={{
                  color: "#46c79a",
                  weight: match.matchId === selected ? 3 : 2,
                  opacity: match.matchId === selected ? 1 : 0.55,
                  dashArray: match.matchId === selected ? undefined : "5 5",
                }}
                eventHandlers={{ click: () => setSelected(match.matchId) }}
              />
            ))}
          </MapContainer>

          <div className="legend">
            <span className="key burn">
              <i /> Burn detection
            </span>
            <span className="key unit">
              <i /> Conversion unit
            </span>
            {matches.length > 0 ? (
              <span className="key link">
                <i /> Assigned route
              </span>
            ) : null}
          </div>
        </div>

        <aside className="panel">
          <h2>Selected match</h2>
          {active ? (
            <>
              <p className="rationale">{active.rationale}</p>
              <dl className="facts">
                <div>
                  <dt>Unit</dt>
                  <dd>{activeUnit?.name ?? active.unitId}</dd>
                </div>
                <div>
                  <dt>District</dt>
                  <dd>{activeLot?.district ?? "unknown"}</dd>
                </div>
                <div>
                  <dt>Feedstock</dt>
                  <dd>{(activeLot?.feedstock ?? "").replace(/_/g, " ") || "—"}</dd>
                </div>
                <div>
                  <dt>Assigned</dt>
                  <dd>{n1.format(active.assignedTonnes)} t</dd>
                </div>
                <div>
                  <dt>Road distance</dt>
                  <dd>{n1.format(active.distanceKm)} km</dd>
                </div>
                <div>
                  <dt>Transport debit</dt>
                  <dd>{n1.format(active.transportKgCo2e)} kgCO₂e</dd>
                </div>
              </dl>
            </>
          ) : (
            <p className="empty">
              {matches.length === 0
                ? "Run matching to assign these lots to conversion units."
                : "Pick a route on the map."}
            </p>
          )}

          {matches.length > 0 ? (
            <>
              <h2>All matches</h2>
              <ul className="match-list">
                {matches.map((m) => (
                  <li key={m.matchId}>
                    <button
                      className={m.matchId === selected ? "on" : ""}
                      onClick={() => setSelected(m.matchId)}
                    >
                      <span>{unitById.get(m.unitId)?.name ?? m.unitId}</span>
                      <b>{n1.format(m.distanceKm)} km</b>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {unmatched.length > 0 ? (
            <p className="empty">
              {unmatched.length} lot{unmatched.length === 1 ? "" : "s"} could not be placed within{" "}
              {MAX_RADIUS_KM} km of a unit with capacity.
            </p>
          ) : null}
        </aside>
      </div>
    </div>
  );
};
