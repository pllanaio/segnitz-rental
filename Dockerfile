FROM node:26.10.0-alpine3.23@sha256:c3c6e314fd42e41962360b2482fc18d150beb47976c3aa7b8b9689d7ef42a5c2

ENV NODE_ENV=production \
    TZ=Europe/Berlin \
    BUSINESS_TIME_ZONE=Europe/Berlin

WORKDIR /app

RUN apk upgrade --no-cache libcrypto3 libssl3 \
    && apk add --no-cache tzdata su-exec \
    && mkdir -p /app/public/img/products /app/uploads/returns \
    && chown node:node /app /app/public/img/products /app/uploads/returns

COPY --chown=root:root --chmod=0755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

COPY --chown=node:node package*.json ./

USER node

RUN npm ci --omit=dev \
    && npm cache clean --force

COPY --chown=node:node . .

USER root

# npm is required only while installing dependencies. Removing the bundled CLI
# keeps its unrelated transitive packages out of the production attack surface.
RUN rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["su-exec", "node:node", "node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT || 3000}/live`).then(response => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]

ENTRYPOINT ["docker-entrypoint.sh"]

CMD ["node", "server.js"]
