# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: no third-party install scripts run during the build. better-sqlite3 and
# @node-rs/argon2 ship prebuilt binaries, so no compiler is needed.
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1 WIKI_DATA_DIR=/tmp/build-data
COPY tsconfig.json next.config.ts postcss.config.mjs ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runner
LABEL org.opencontainers.image.title="Tidewiki" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="https://github.com/Pragma-1/tidewiki" \
      org.opencontainers.image.url="https://github.com/Pragma-1/tidewiki" \
      org.opencontainers.image.description="Self-hosted Markdown wiki with 2FA, live updates and read-only public mode"
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 WIKI_DATA_DIR=/data
WORKDIR /app
RUN mkdir /data && chmod 700 /data
# Application files stay root-owned and read-only for the runtime user.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY docker-entrypoint.cjs tidewiki-cli.cjs ./
# No USER line on purpose: the entrypoint starts as root, applies PUID/PGID to /data, then drops root.
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "docker-entrypoint.cjs"]
