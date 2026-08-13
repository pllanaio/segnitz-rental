#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
    echo "docker-entrypoint.sh must start as root to prepare the upload volumes" >&2
    exit 1
fi

mkdir -p /app/public/img/products /app/uploads/returns
chown node:node /app/public/img/products /app/uploads/returns

exec su-exec node:node "$@"
