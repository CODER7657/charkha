# Who uses which screen, and in what order

Charkha has four kinds of user, named in the problem statement: **municipalities**,
**farms**, **food and industrial waste generators**, and **conversion facility
operators**. Plus one more who is not a user but decides everything: the
**auditor or buyer** who has to believe the credit.

Each has one screen. This is the order things actually happen in.

---

## 0. How to get a match id — read this first

A `matchId` is the thing the Field screen asks for, and it is the single most
confusing part of the system, so: **you never type it.**

A match is created when the operator routes a residue lot to a conversion unit.
Once that exists, the Field screen **lists it for you**:

> **Which batch is this?**
> **Ferozepur Biomass Hub** — 31 km · 1.6 t · mixed
> **Rajkot Biochar Co-op** — 84 km · 3.0 t · mixed

Tap one. It fills in the id *and* the feedstock. That is the whole answer.

**Three things worth knowing:**

- The list shows only batches **with no photo submitted yet** — which is the
  actual question ("which batch have I not done?"). A batch that already has
  evidence would only walk you into the one-photo-one-credit refusal.
- If the list is empty, nobody has run matching yet. Someone has to press
  **Run matching** on the Operator screen first. That is step 1 below.
- If you are on the phone and an operator is on a laptop, they can read you the
  id: it is under the picker with a **copy** button next to it.

---

## 1. Operator — the conversion facility operator

**Screen: Operator.** English. This is a desk job, not a field job.

| step | what you press | what happens |
|---|---|---|
| 1 | *(nothing — it loads itself)* | Real NASA FIRMS thermal detections appear as orange points, conversion units as green squares |
| 2 | **Pull detections** | Asks NASA for new hotspots. `No new detections` is a normal answer — the dedupe is working |
| 3 | Choose **60 / 75 / 115 km** | How far a truck may haul. 60 is the real biomass catchment |
| 4 | **Run matching** | Every listed lot is assigned to the nearest unit that has capacity *and* accepts its feedstock |
| 5 | Click a green route | The panel shows the rationale, the road distance, and the **transport debit** in kgCO₂e |

**Capacity is per day, not per click.** A unit that is full will not be
over-committed, so a second round the same day can legitimately return
`0 matched`. That is the system refusing, not failing.

**What this step produces:** the matches that Field capture will list.

---

## 2. Field — the farmer or the plant's field worker

**Screen: Field.** Available in English, Hindi, Punjabi and Gujarati. Designed
for a cheap phone, outdoors, possibly offline.

| step | what you press | what happens |
|---|---|---|
| 1 | **1 · PHOTO** → take photo | The model runs **on the phone**. The photograph never leaves it |
| 2 | **2 · BATCH** → tap a batch in the list | Fills the match id and the feedstock |
| 3 | Fill peak temperature, residence time, output tonnes | These are what the methodology actually checks |
| 4 | **Use device location** | Or type coordinates by hand |
| 5 | Open **"This is what leaves your phone"** | ~700 bytes. A hash, a model hash, scores. **No image** |
| 6 | **3 · SUBMIT** | The verifier scores it and returns a verdict |

**If you go offline mid-capture**, inference still runs and the submission
queues on the device. It retries by itself when the signal returns.

**"Sent. Take a new photo for the next batch."** is a success, not an error.
One photograph can only ever produce one credit — a unique index in the
database enforces it, not a check someone could forget.

---

## 3. Saathi — anyone who does not want to learn a dashboard

**Screen: Saathi.** Four languages. This is the door for a farmer or a ward
clerk who will never open the Operator screen.

Type or tap a starter in your own language:

- *"ਲੁਧਿਆਣਾ ਵਿੱਚ ਸਾਡੇ ਕੂੜੇ ਦਾ ਕੀ ਹੋਇਆ?"* — what happened to our waste
- *"we have 4.5 t of mixed waste in Karnal"* — declare waste that never burns
- *"how much CO2 did Ludhiana save?"*

It shows you **which agents it called** to answer, with their task ids and
latency. Anything that would **change** something is proposed first and waits
for you to confirm — it never acts on its own.

**This is the second way in.** A municipality landfills its organic waste; it
never burns, so no satellite can ever see it. Declaring is how those generators
enter the system at all, and a declared lot is marked `declared`, never
`detected`.

---

## 4. Audit — the auditor, the buyer, the judge

**Screen: Audit.** English. This is where you stop trusting us.

| step | what you press | what happens |
|---|---|---|
| 1 | **Verify chain in this browser** | Every record is re-hashed **in your browser**. Not our server's word |
| 2 | **trace** on any decision row | Pulls that task's evidence, decision and credential as one thread |
| 3 | **copy** on any id | Task id, hash or previous hash — the full value, not the shortened one on screen |
| 4 | **Tamper demo**, edit a row, verify again | The chain breaks at exactly that row and the view scrolls to it |

**How to get a task id:** every decision row shows one, with a copy button.
Or just press **trace** on the row — it never leaves the screen.

**Which task ids can be traced:** only ones that *wrote* to the ledger.
Reads — listing lots, listing units, most Saathi answers — never call
`appendDecision`, so their task ids are real and untraceable at the same time.
The screen says so if you paste one.

---

## 5. Break It — for the judge who does not believe any of it

**Screen: Break It.** Six attacks, each firing a **real request at the live
API**, each showing the real status code and the real refusal body.

Press them. A refusal is a pass. Two of the six honestly report
`not proved`, because the agents are not reachable from a browser and faking
a result would defeat the point of the screen.

---

## 6. Provenance — where every number came from

**Screen: Provenance.** Read live from the running services, so it cannot drift
away from the system it describes.

Every carbon constant with its IPCC citation. The honesty table: what is real,
what is partial, what we did not build. The area the satellite feed covers and
the box we deliberately drop from it.

---

## The short version

```
Operator  →  Run matching        creates the batches
Field     →  tap a batch, photo  creates the evidence
Audit     →  trace / verify      proves the credit
Break It  →  press anything      proves the refusals
```

Saathi sits beside all of it for anyone who would rather ask a question than
learn a screen. Provenance sits underneath all of it for anyone who wants to
know where a number came from.
