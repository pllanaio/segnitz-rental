FROM node:24.19.0-alpine3.23@sha256:244cc2b53f46f9e876304391d17682b0ddae9ac33491f4857e25e35a36ba7995 AS frontend-build

WORKDIR /build/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

FROM node:24.19.0-alpine3.23@sha256:244cc2b53f46f9e876304391d17682b0ddae9ac33491f4857e25e35a36ba7995 AS backend-dependencies

WORKDIR /app
COPY --chown=node:node package*.json ./

USER node
RUN npm ci --omit=dev \
    && npm cache clean --force

FROM node:24.19.0-alpine3.23@sha256:244cc2b53f46f9e876304391d17682b0ddae9ac33491f4857e25e35a36ba7995 AS runner

ENV NODE_ENV=production \
    TZ=Europe/Berlin \
    BUSINESS_TIME_ZONE=Europe/Berlin \
    FRONTEND_DIST_DIR=/app/frontend-dist

WORKDIR /app

RUN apk add --no-cache tzdata su-exec \
    && mkdir -p /app/public/img/products /app/uploads/returns \
    && chown node:node /app /app/public/img/products /app/uploads/returns

COPY --chown=root:root --chmod=0755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY --from=backend-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .
COPY --from=frontend-build --chown=root:root /build/frontend/out ./frontend-dist

# Der Runner enthält nur den unveränderlichen Export, Upload-Verzeichnisse und
# Backend-Code. Legacy-HTML/JS/CSS sowie die Frontend-Toolchain bleiben draußen.
USER root
RUN rm -rf /app/frontend /app/public/css /app/public/js \
    && rm -f /app/public/*.html
RUN rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["su-exec", "node:node", "node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT || 3000}/live`).then(response => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
