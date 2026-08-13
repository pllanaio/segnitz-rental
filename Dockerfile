FROM node:24.19.0-alpine3.23@sha256:244cc2b53f46f9e876304391d17682b0ddae9ac33491f4857e25e35a36ba7995

ENV NODE_ENV=production \
    TZ=Europe/Berlin \
    BUSINESS_TIME_ZONE=Europe/Berlin

WORKDIR /app

RUN apk add --no-cache tzdata su-exec \
    && mkdir -p /app/public/img/products /app/uploads/returns \
    && chown node:node /app /app/public/img/products /app/uploads/returns

COPY --chown=root:root --chmod=0755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

COPY --chown=node:node package*.json ./

USER node

RUN npm ci --omit=dev \
    && npm cache clean --force

COPY --chown=node:node . .

USER root

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["su-exec", "node:node", "node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT || 3000}/live`).then(response => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]

ENTRYPOINT ["docker-entrypoint.sh"]

CMD ["node", "server.js"]
