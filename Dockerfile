# Debian, not Alpine, deliberately.
#
# onnxruntime-node ships prebuilt native bindings linked against glibc. Alpine
# is musl, so the verifier would install cleanly and then fail the first time it
# actually ran inference - at the worst possible moment. The image is a little
# larger; that is a trade worth making for the component the whole pitch rests
# on.
FROM node:22-slim

RUN corepack enable

WORKDIR /app

# Manifests first so a dependency-only change reuses the install layer.
COPY pnpm-workspace.yaml package.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/a2a/package.json ./packages/a2a/
COPY packages/db/package.json ./packages/db/
COPY agents/producer/package.json ./agents/producer/
COPY agents/matchmaker/package.json ./agents/matchmaker/
COPY agents/verifier/package.json ./agents/verifier/
COPY agents/registry/package.json ./agents/registry/
COPY apps/gateway/package.json ./apps/gateway/
COPY apps/web/package.json ./apps/web/

RUN pnpm install --no-frozen-lockfile

COPY tsconfig.base.json ./
COPY packages ./packages
COPY agents ./agents
COPY apps ./apps
COPY scripts ./scripts
COPY ml ./ml

# No `|| true` here. A web build that fails silently means the gateway serves
# nothing and we find out during the demo.
RUN pnpm -F @charkha/web build

EXPOSE 4000 4001 4002 4003 4004

CMD ["pnpm", "-F", "@charkha/gateway", "start"]
