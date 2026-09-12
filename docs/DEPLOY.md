# Deploying Charkha

One Azure VM running the whole stack behind Caddy, with real TLS on a real
hostname.

**Why a VM and not a laptop tunnel:** the field capture view uses the camera and
WebGPU, and both require a *secure context*. A judge opening `http://192.168.x.x`
gets a blank capture screen and a confusing error. TLS is not polish here, it is
the difference between the demo working and not.

**Target: hour 30 of 40.** The first deploy always surfaces something. Find it
with ten hours left, not two.

---

## 0. What you need before starting

| | |
|---|---|
| Azure account | The $100 student credit is enough — the VM below is ~$30/month |
| A FIRMS key | Free, registration round-trip: <https://firms.modaps.eosdis.nasa.gov/api/map_key/> |
| Azure CLI | `winget install Microsoft.AzureCLI` |
| SSH | Ships with Git for Windows at `C:\Program Files\Git\usr\bin\ssh.exe` |

### Why these VM specs, specifically

```
Standard_B2as_v2 — 2 vCPU, 8 GiB RAM, x86_64 (AMD)
```

- **x86 is mandatory, not a preference.** `onnxruntime-node` publishes no
  prebuilt Linux `arm64` binary ([microsoft/onnxruntime#8176]). An ARM VM
  installs cleanly and then fails the first time the verifier runs inference —
  at the worst possible moment. Never pick an Ampere SKU, and note that ARM
  sizes are easy to choose by accident: they carry a `p` in the name
  (`Standard_D2ps_v5`, `Standard_B2pts_v2`). Intel and AMD sizes are both fine.
- **4 GiB minimum.** Postgres, four agents, the gateway and Caddy, plus
  200–400 MB when the verifier loads its model. A 1 GiB free-tier box OOMs.

> **`Standard_B2s` was our first choice and Azure refused it.** Preflight
> returned `SkuNotAvailable — Capacity Restrictions` in `centralindia`. This is
> not a quota problem and asking for more quota does not fix it; that size is
> simply full in that region. `Standard_B2as_v2` (AMD, 8 GiB) was available
> immediately in the same region.
>
> **Expect this and do not lose time to it.** If a size is refused, try another
> x86 size before you try another region — a nearby region is worth more on
> demo day than any particular SKU name. Working fallbacks, all x86:
> `Standard_B2as_v2`, `Standard_D2s_v3`, `Standard_D2as_v5`.
>
> Do not bother pre-checking with `az vm list-skus`: it is slow, and on a
> constrained link it can take longer than simply attempting the create.
> Preflight failures come back in seconds and name the reason precisely.

[microsoft/onnxruntime#8176]: https://github.com/microsoft/onnxruntime/issues/8176

---

## 1. Sign in (you, once)

```bash
az login
```

This opens a browser. Nobody else can do this step for you, and nobody should
ever be handed your credentials. Everything after it uses the cached token.

```bash
az account show --output table          # confirm the right subscription
```

---

## 2. Create the VM

```bash
az group create \
  --name charkha-rg \
  --location centralindia
```

Pick a region close to the venue — latency shows on stage. `centralindia`,
`southeastasia` and `eastus` are all reasonable.

```bash
Generate a key first. `--generate-ssh-keys` needs `ssh-keygen` on PATH, and on
Windows it usually is not, even though Git ships one:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/charkha_azure -N "" -C "charkha-deploy"
```

```bash
az vm create   --resource-group charkha-rg   --name charkha-vm   --image Ubuntu2404   --size Standard_B2as_v2   --admin-username charkha   --ssh-key-values "$(cat ~/.ssh/charkha_azure.pub)"   --public-ip-sku Standard   --os-disk-size-gb 32   --output table
```

Takes a few minutes. Note the `publicIpAddress` from the output. Keys only —
password authentication is deliberately not used.

Open only what we serve on:

```bash
az vm open-port --resource-group charkha-rg --name charkha-vm --port 80  --priority 900
az vm open-port --resource-group charkha-rg --name charkha-vm --port 443 --priority 901
```

**Do not open 4000–4004.** The agents and the gateway are reachable through
Caddy only. An exposed gateway is an unauthenticated write endpoint.

---

## 3. A hostname

Azure will give the VM a free DNS label, which is enough for a real certificate:

```bash
az network public-ip update \
  --resource-group charkha-rg \
  --name charkha-vmPublicIP  # confirm with: az network public-ip list -g charkha-rg --query "[0].name" -o tsv \
  --dns-name charkha-hashhawks \
  --output table
```

That yields `charkha-hashhawks.centralindia.cloudapp.azure.com`. Verify it
resolves before asking Caddy for a certificate — Let's Encrypt rate-limits
failures, and a premature attempt costs you an hour:

```bash
nslookup charkha-hashhawks.centralindia.cloudapp.azure.com
```

---

## 4. Docker on the box

```bash
ssh -i ~/.ssh/charkha_azure charkha@<public-ip>
```

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo tee /etc/apt/keyrings/docker.asc > /dev/null
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
```

Log out and back in so the group takes effect, then check:

```bash
docker run --rm hello-world
```

---

## 5. The code and its secrets

```bash
git clone https://github.com/CODER7657/charkha.git
cd charkha
```

Secrets are generated on the box and never leave it:

```bash
docker run --rm -v "$PWD":/app -w /app node:22-slim node scripts/setup-env.ts
```

Or, if you would rather not install anything to do it, generate by hand — the
values are just random hex:

```bash
cp .env.example .env
PG=$(openssl rand -hex 16)
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$PG|" .env
sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgres://charkha:$PG@db:5432/charkha|" .env
sed -i "s|^A2A_JWT_SECRET=.*|A2A_JWT_SECRET=$(openssl rand -hex 32)|" .env
sed -i "s|^REGISTRY_DID_SEED=.*|REGISTRY_DID_SEED=$(openssl rand -hex 32)|" .env
chmod 600 .env
```

Then fill the two things a generator cannot know:

```bash
nano .env
#   FIRMS_MAP_KEY=<your key>
#   PUBLIC_BASE_URL=https://charkha-hashhawks.centralindia.cloudapp.azure.com
```

> **`REGISTRY_DID_SEED` is the credential signing key.** It is generated on the
> box, it is in a `600` file, it is gitignored, and it must never appear in a
> log line, a screen share, or a commit. If it is ever exposed, regenerate it —
> previously issued credentials stop verifying, which during a hackathon is a
> nuisance rather than a disaster.

---

## 6. TLS

Nothing to edit. The `Caddyfile` reads the hostname from the environment, so
this is one more line in `.env`:

```bash
CHARKHA_HOSTNAME=charkha-hashhawks.centralindia.cloudapp.azure.com
```

Left blank, Caddy serves plain `:80` — fine for a local `docker compose up`, and
**not** fine for the demo, because the camera and WebGPU need a secure context.

Caddy obtains and renews the certificate itself. No certbot, no cron.

---

## 7. Up

```bash
docker compose up -d --build
```

> **If you changed `Caddyfile`, that is not enough.** `git pull` replaces the
> file rather than editing it in place, and Docker bind-mounts a single file by
> inode — so the container keeps serving the config it started with, and
> `caddy reload` happily reloads the *old* file. Recreate it:
>
> ```bash
> docker compose up -d --force-recreate caddy
> ```
>
> Verify with `curl -I https://<host>/ | grep -i content-security-policy`
> rather than assuming.

First build pulls the Node image and installs the workspace — several minutes.

```bash
docker compose ps          # every service up; gateway healthy
docker compose logs -f gateway
```

`migrate` applies the schema and seeds the conversion units, and the agents wait
for it rather than racing an empty database. It should exit `0` and stay exited.

---

## 8. Prove it actually works

Not "the containers are running" — that is not the same thing.

```bash
curl -s https://charkha-hashhawks.centralindia.cloudapp.azure.com/api/health | jq
```

All four agents must report `up`. Then run the same smoke check CI runs:

```bash
node scripts/smoke.mjs https://charkha-hashhawks.centralindia.cloudapp.azure.com
```

Expected:

```
ok    mesh healthy (4 agents)
ok    producer.listLots reachable - task <uuid> completed
smoke passed: the mesh is alive and a skill is reachable end to end.
```

**The field view's assets are the thing most likely to be quietly broken.** The
gateway serves the SPA with a catch-all fallback, so a missing asset returns
`index.html` rather than a 404, and `onnxruntime-web` then fails with a parse
error that looks nothing like "file not found":

```bash
curl -sI https://.../models/char-quality.onnx | grep -i content-type   # NOT text/html
curl -sI https://.../ort/ort-wasm-simd-threaded.asyncify.wasm | grep -i content-type
```

If either returns `text/html`, the model did not make it into `dist` — check
that `ml/` was copied before the web build in the Dockerfile.

---

## 9. The walk-through nobody has done yet

Every stage works in isolation and in tests. The **whole chain has never been
run once.** Do this before rehearsing anything:

1. **Operator** — pull detections, confirm real fire pixels appear on the map
2. **Operator** — run matching, confirm routes draw and a rationale renders
3. **Field, on an actual phone** — open `/#field` over HTTPS, capture, confirm
   inference runs and the payload preview shows a hash and no image
4. **Field, offline** — aeroplane mode mid-capture: inference still runs and the
   submission queues; back online, it retries and lands
5. **Audit** — the verdict appears, chain verifies in the browser
6. **Registry** — issue a credit, then retire it
7. **Audit** — paste the task id into the lookup and confirm the whole thread
   renders: evidence → decision → credential
8. **Tamper** — edit a record in the console, watch it go red at exactly that seq

Anything that fails here is worth more than any feature still unbuilt.

---

## Operating it

```bash
docker compose logs -f <service>       # producer | matchmaker | verifier | registry | gateway
docker compose restart gateway
docker compose down && docker compose up -d --build      # after a git pull
docker compose exec db psql -U charkha -d charkha        # database
```

Stop the meter between sessions and restart when needed:

```bash
az vm deallocate --resource-group charkha-rg --name charkha-vm
az vm start      --resource-group charkha-rg --name charkha-vm
```

`deallocate` stops billing for compute; `az vm stop` does **not**.

Tear down everything, including the disk and IP:

```bash
az group delete --name charkha-rg --yes --no-wait
```

---

## When it goes wrong

| Symptom | Cause |
|---|---|
| Caddy will not get a certificate | DNS not resolving yet, or 80/443 closed. Check `nslookup` first; Let's Encrypt rate-limits repeated failures |
| Camera does nothing on the phone | Not a secure context. Must be `https://`, not an IP |
| Field view: model fails to parse | An asset 404'd into `index.html`. See §8 |
| Verifier crashes on inference | ARM VM. `onnxruntime-node` has no arm64 binary — rebuild on x86 |
| `migrate` exits non-zero | `POSTGRES_PASSWORD` unset in `.env`; compose requires it deliberately |
| Agents up, calls 404 | Gateway cannot reach agents; check service names in compose |
| Everything slow, OOM kills | VM too small. 2 vCPU / 4 GiB minimum |
| Caddyfile edits do nothing | `git pull` writes a NEW file, so the single-file bind mount still points at the old inode. `docker compose up -d --force-recreate caddy` — a plain `up` and even `caddy reload` will not help |
| `SkuNotAvailable` at create | Capacity restriction, not quota. Try another x86 size before another region — see §0 |

---

## What we say about this on stage

Deployed on a single VM with real TLS, all inference local, one read-only
outbound call to a public satellite feed. The message queue is in-memory behind
a broker-shaped interface and we say so. Nothing about this is a managed service
holding our data.
