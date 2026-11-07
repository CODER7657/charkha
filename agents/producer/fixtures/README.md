# Bundled sample feed

`firms-sample.csv` is a **synthetic** response in the wire format of the NASA
FIRMS area API: same value conventions — `acq_time` as `HHMM`, confidence as
`l`/`n`/`h`, `frp` in MW.

It carries a leading `country_id` column that the live `VIIRS_NOAA20_NRT`
response does **not** have. That difference is deliberate and harmless, and it
is worth knowing why: the parser reads by header **name**, never by column
position, so the two shapes are interchangeable. Verified against the live feed
— a parser keyed on position would have shifted every field by one and silently
corrupted every lot.

It is **not** a recorded NASA response, and nothing in the demo presents it as
one. Detections are placed in the Punjab/Haryana residue belt around the seeded
conversion units so that a clean clone draws a populated map before anyone has
registered a `FIRMS_MAP_KEY`.

It sits at the very end of the fallback chain:

```
live feed  ->  newest file in data/firms-cache/  ->  this file
```

So the moment the agent runs once with a real key, `data/firms-cache/` holds a
genuine response and that is what the fallback serves instead.

Which of the three was used is reported on every run through `ctx.progress()`,
so it is in the task's event stream and in the agent log. It is **not** yet on
the operator view: `IngestBurnsOutput` has no field for it, and widening a
contract is a separate one-file PR. Until that lands, do not read a populated
map as proof that the live feed answered — check the progress line.

Two rows carry `confidence=l` on purpose: they exercise the low-confidence
filter, which refuses to create a residue lot from a detection the satellite
itself was unsure about.
