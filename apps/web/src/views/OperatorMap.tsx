import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import type { ConversionUnit, FeedOrigin, Match, ResidueLot } from "@charkha/core";
import { DEFAULT_RADIUS_KM, RADIUS_OPTIONS, summarise, unplacedMessage } from "./operator/summary.ts";
import { allRouteBounds, framingKey, routeBounds, type Bounds } from "./operator/fit.ts";
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

/**
 * India - the bbox the producer pulls, INDIA_BBOX in firms.ts.
 *
 * Centred slightly north of the geographic centre because that is where the
 * detections and the units both are: the belt still carries most of the map,
 * it is just no longer the whole of it. Zoom 5 fits Punjab to Tamil Nadu in a
 * projector-shaped frame without the user touching a control.
 */
const MAP_CENTRE: [number, number] = [22.8, 79.5];
const MAP_ZOOM = 5;

type Envelope<T> = { taskId?: string; output: T };

/** The shape of IngestBurnsOutput we actually read here. */
type IngestResult = { lotsCreated: number; origin: FeedOrigin; originNote: string };

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
  iconSize: [13, 13],
  iconAnchor: [7, 7],
});

/**
 * How close a single route is allowed to be framed.
 *
 * A 60 km route across a padded viewport is unmistakable; without a cap,
 * fitBounds on a short route would drop the demo to street level, where a
 * judge has lost the country and the point with it.
 */
const ROUTE_MAX_ZOOM = 10;
/** Breathing room so an endpoint never sits under the map edge or the legend. */
const FIT_PADDING: [number, number] = [56, 56];

/**
 * Moves the map, and nothing else.
 *
 * Lives inside MapContainer because that is the only place `useMap` has a map
 * to talk to. `bounds` null means there is nowhere to look - a round that
 * placed nothing, or nothing selected yet - and then this does NOTHING, which
 * is what keeps the screen open on India until a round has actually run.
 */
const Frame = ({ bounds, maxZoom, homeKey }: { bounds: Bounds | null; maxZoom: number; homeKey: string }) => {
  const map = useMap();
  const key = framingKey(bounds);
  /* Refit when the TARGET moves, not when React re-renders. Without this the
     map would refit on every repaint and fight anyone trying to pan it. */
  const applied = useRef<string>("");

  /* Back to the country. Only fires on a deliberate press: `homeKey` is empty
     until the button is used, so the map opens on MapContainer's own centre
     and zoom and is never re-framed on mount. */
  useEffect(() => {
    if (homeKey === "") return;
    map.setView(MAP_CENTRE, MAP_ZOOM, { animate: false });
  }, [map, homeKey]);

  useEffect(() => {
    if (bounds === null || key === "" || key === applied.current) return;
    applied.current = key;

    /* `animate: false` is the whole fix, and it is not a preference.
    
       Leaflet's fitBounds animates the zoom, and that animation waits on a
       CSS transitionend that never arrived here: measured in a production
       build, getBoundsZoom said 9, fitBounds ran, and the zoom was still 5
       immediately after, at +300ms, at +1500ms - with `zoomend` never firing
       at all. The map panned and never scaled, which reads exactly like the
       call being ignored.
    
       Skipping the animation makes setView apply synchronously. It is also
       the better demo: an instant cut to the route is clearer from the back
       of a room than a quarter-second glide, and it cannot get stuck. */
    map.fitBounds(
      [
        [bounds[0][0], bounds[0][1]],
        [bounds[1][0], bounds[1][1]],
      ],
      { padding: FIT_PADDING, maxZoom, animate: false },
    );
  }, [map, bounds, key, maxZoom]);

  return null;
};

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
  /* What the map is looking at. "home" is the country - the scale of the
     problem, and where the screen opens before any round has run. "route"
     frames the selected match; "all" frames every route a round drew.
     
     Deliberately NOT derived from `selected`: clicking a line ON the map must
     select it without yanking the viewport out from under the click. Picking
     a match from the LIST does move the map, because there you are asking to
     be taken somewhere.
     
     `n` counts deliberate requests, so pressing "Whole country" a second time
     after panning away actually takes you back rather than being a no-op. */
  const [framing, setFraming] = useState<{ kind: "home" | "route" | "all"; n: number }>({
    kind: "home",
    n: 0,
  });
  const frame = useCallback(
    (kind: "home" | "route" | "all") => setFraming((f) => ({ kind, n: f.n + 1 })),
    [],
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [unitsMissing, setUnitsMissing] = useState(false);
  const [feed, setFeed] = useState<{ origin: FeedOrigin; note: string } | null>(null);
  /* One value drives the request, the strip and the unplaced sentence. The
     matchmaker also quotes the radius it was given in each per-lot reason, so
     if these could drift the screen would contradict the ledger. */
  const [radiusKm, setRadiusKm] = useState<number>(DEFAULT_RADIUS_KM);
  /* The radius the LAST round actually ran at. Changing the control must not
     retroactively relabel a result that came from a different radius. */
  const [ranAtKm, setRanAtKm] = useState<number>(DEFAULT_RADIUS_KM);

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
      // /api/units exists (#14), so reaching here means the matchmaker or the
      // gateway is down. Degrade to a detections-only map and say so, rather
      // than rendering a silently half-drawn picture that looks complete.
      setUnits([]);
      setUnitsMissing(true);
    }
  }, []);

  const ingest = useCallback(async () => {
    const res = await post<Envelope<IngestResult>>("/ingest", {});
    if (res.output) setFeed({ origin: res.output.origin, note: res.output.originNote });
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
        maxRadiusKm: radiusKm,
      });
      const next = res.output?.matches ?? [];
      const unplaced = res.output?.unmatchedLotIds ?? [];
      setMatches(next);
      setUnmatched(unplaced);
      setSelected(next[0]?.matchId ?? null);
      /* Frame the route the round selected. Fitting to ALL of them was the
         obvious move and it does not work: measured on the deployed host,
         matched lots span Tamil Nadu to Punjab, so "fit every route" returns
         the national view we started from and the lines stay 13 pixels long.
         A round that placed nothing frames nothing - `selected` is null, the
         bounds are null, and the map stays where it is. */
      if (next.length > 0) frame("route");
      setRanAtKm(radiusKm);
      await loadLots();
      return `${next.length} matched, ${unplaced.length} unplaced at ${radiusKm} km`;
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

  const totals = useMemo(() => summarise(lots, matches), [lots, matches]);

  /* Where the map should be looking, as geometry. Null means nowhere - a round
     that placed nothing, or a selection whose lot or unit has not loaded - and
     `Frame` then leaves the viewport alone rather than throwing inside Leaflet
     on an empty bounds. */
  const mapBounds = useMemo<Bounds | null>(() => {
    if (framing.kind === "all") return allRouteBounds(lines);
    if (framing.kind !== "route") return null;
    const line = lines.find((l) => l.match.matchId === selected);
    return line ? routeBounds(line.from, line.to) : null;
  }, [framing.kind, lines, selected]);

  /* Only a deliberate press goes home, so the map opens on the country from
     MapContainer's own centre and zoom and is not re-framed on mount. */
  const homeKey = framing.kind === "home" && framing.n > 0 ? `home:${framing.n}` : "";

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
        {/* Fixed steps rather than a slider: each is an operating choice we
            can defend out loud, and the selected one stays visible on screen
            rather than collapsing into a dropdown. */}
        <span className="radius" role="group" aria-label="Match radius">
          <span className="radius-label">Radius</span>
          {RADIUS_OPTIONS.map((km) => (
            <button
              key={km}
              type="button"
              className={km === radiusKm ? "radius-step on" : "radius-step"}
              aria-pressed={km === radiusKm}
              disabled={busy}
              onClick={() => setRadiusKm(km)}
            >
              {km} km
            </button>
          ))}
        </span>
        {/* Where to look. Disabled until a round has drawn something, so the
            buttons never promise a view that does not exist yet. */}
        <span className="framing" role="group" aria-label="Map view">
          <button
            type="button"
            className="frame-step"
            disabled={busy || selected === null}
            onClick={() => frame("route")}
          >
            Selected route
          </button>
          <button
            type="button"
            className="frame-step"
            disabled={busy || lines.length === 0}
            onClick={() => frame("all")}
          >
            All routes
          </button>
          <button type="button" className="frame-step" disabled={busy} onClick={() => frame("home")}>
            Whole country
          </button>
        </span>
        <span className="muted">{msg}</span>
      </div>

      <div className="strip">
        <Stat label="Lots listed" value={nf.format(totals.listed)} unit={`of ${nf.format(totals.onMap)} on map`} />
        <Stat label="Tonnes available" value={n1.format(totals.tonnes)} unit="t" />
        {/* Scoped to this round on purpose: the map shows earlier rounds too,
            and "Matched 0" beside 36 already-matched markers is only confusing
            if the label does not say which it means. */}
        <Stat label="Matched this round" value={nf.format(totals.matched)} unit={unmatched.length > 0 ? `of ${totals.listed}` : undefined} />
        <Stat label="Transport debit" value={n1.format(totals.debit)} unit="kgCO₂e" />
      </div>

      {feed && feed.origin !== "live" ? (
        <p className="origin warn">
          {feed.origin === "cache" ? "Showing cached detections" : "Showing the bundled sample feed"} —{" "}
          {feed.note}
        </p>
      ) : null}
      {feed?.origin === "live" ? <p className="origin">{feed.note}</p> : null}

      {unitsMissing ? (
        <p className="origin warn">
          Could not load conversion units — the matchmaker may be down. Showing detections only; routes
          and unit markers are hidden rather than guessed at.
        </p>
      ) : null}

      <div className="board">
        <div className="map-wrap">
          {/* Wheel zoom off on purpose: the map is taller than most laptop
              viewports, so a wheel that zoomed would swallow every attempt to
              scroll the page and drop the demo out over Rajasthan. The +/-
              control and double-click still zoom. */}
          <MapContainer center={MAP_CENTRE} zoom={MAP_ZOOM} scrollWheelZoom={false}>
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              maxZoom={18}
            />

            <Frame bounds={mapBounds} maxZoom={ROUTE_MAX_ZOOM} homeKey={homeKey} />

            {lots.map((lot) => {
              /* A listed lot is solid; a matched one is hollow and smaller, so
                 running a round visibly changes the map rather than only adding
                 lines. Fill and radius carry the state, not hue alone - a
                 projector crushes contrast and two oranges would read as one.
                 The dark ring keeps overlapping detections countable where they
                 cluster, which they do around Ferozepur. */
              const isListed = lot.status === "listed";
              return (
              <CircleMarker
                key={lot.lotId}
                center={[lot.at.lat, lot.at.lon]}
                radius={isListed ? 6 : 4}
                pathOptions={{
                  color: "#0f1211",
                  weight: 1.5,
                  fillColor: "#ff7038",
                  fillOpacity: isListed ? 0.95 : 0.28,
                }}
              >
                <Popup>
                  <b>{n1.format(lot.tonnes)} t</b> {lot.feedstock.replace(/_/g, " ")}
                  <br />
                  {lot.district ?? "district unknown"} · {lot.status}
                  <br />
                  {new Date(lot.availableFrom).toUTCString()}
                </Popup>
              </CircleMarker>
              );
            })}

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

            {/* Both ends of the selected route, marked.
            
                At national zoom a 60 km route is about 13 pixels, and 3px
                solid against 2px dashed does not carry that difference across
                a room. A ring at each end is visible at any zoom and says
                WHERE the route is even when the line itself is a smudge. */}
            {activeLot && activeUnit
              ? [
                  { id: "from", at: activeLot.at },
                  { id: "to", at: activeUnit.at },
                ].map((end) => (
                  <CircleMarker
                    key={`halo-${end.id}`}
                    center={[end.at.lat, end.at.lon]}
                    radius={11}
                    interactive={false}
                    pathOptions={{ color: "#46c79a", weight: 2, fill: false, opacity: 0.9 }}
                  />
                ))
              : null}

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
            <span className="key matched">
              <i /> Already matched
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
                    {/* Picking from the list takes you there; clicking the line
                        on the map only selects, because you are already looking
                        at it and moving the viewport under the click is rude. */}
                    <button
                      className={m.matchId === selected ? "on" : ""}
                      onClick={() => {
                        setSelected(m.matchId);
                        frame("route");
                      }}
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
            <p className="empty">{unplacedMessage(unmatched.length, ranAtKm)}</p>
          ) : null}
        </aside>
      </div>
    </div>
  );
};
