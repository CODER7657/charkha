FROM node:22-alpine
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json ./
COPY packages ./packages
COPY agents ./agents
COPY apps ./apps
COPY scripts ./scripts
COPY tsconfig.base.json ./
RUN pnpm install --frozen-lockfile=false
RUN pnpm -F @charkha/web build || echo "web build skipped"
COPY ml ./ml
EXPOSE 4000 4001 4002 4003 4004
CMD ["pnpm", "-F", "@charkha/gateway", "start"]
