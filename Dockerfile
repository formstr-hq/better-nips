FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN corepack enable

FROM base AS dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN mkdir -p public \
    && pnpm build \
    && test -f .next/standalone/server.js

FROM base AS web
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/`).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "server.js"]

FROM build AS worker-runtime
ENV NODE_ENV=production
RUN pnpm prune --prod
USER node

FROM worker-runtime AS worker
CMD ["node", "dist-worker/run.js"]

FROM build AS migration
ENV NODE_ENV=production
USER node
CMD ["node_modules/.bin/drizzle-kit", "migrate"]
