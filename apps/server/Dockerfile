# syntax=docker/dockerfile:1.7
FROM node:24-alpine AS build

WORKDIR /workspace
RUN corepack enable
COPY . .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

ARG MACROGRAPH_BASE_PATH=/
ARG VITE_OTEL_EXPORTER_OTLP_ENDPOINT
ENV MACROGRAPH_BASE_PATH=$MACROGRAPH_BASE_PATH
ENV VITE_OTEL_EXPORTER_OTLP_ENDPOINT=$VITE_OTEL_EXPORTER_OTLP_ENDPOINT
RUN pnpm --filter @macrograph/server build

FROM node:24-alpine AS runtime

ARG MACROGRAPH_BASE_PATH=/
ARG VITE_OTEL_EXPORTER_OTLP_ENDPOINT
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    MACROGRAPH_DATA_DIR=/data \
    MACROGRAPH_BASE_PATH=$MACROGRAPH_BASE_PATH \
    MACROGRAPH_BROWSER_OTLP_ENDPOINT=$VITE_OTEL_EXPORTER_OTLP_ENDPOINT
WORKDIR /app
COPY --from=build --chown=node:node /workspace/apps/server/dist ./dist
RUN install -d -o node -g node -m 0750 /data

USER 1000:1000
VOLUME ["/data"]
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "const b=(process.env.MACROGRAPH_BASE_PATH||'').replace(/\\/$/,'');fetch('http://127.0.0.1:'+process.env.PORT+b+'/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/esm/index.js"]
