#!/bin/sh
# Select nginx config by ENABLE_HTTPS (true = HTTPS, false = HTTP only).
set -e
if [ "${ENABLE_HTTPS}" = "true" ]; then
  cp /etc/nginx/conf.d/nginx-https.conf /etc/nginx/conf.d/default.conf
  https_port="${FRONTEND_HTTPS_PORT:-8443}"
  sed -i "s/@@FRONTEND_HTTPS_PORT@@/${https_port}/g" /etc/nginx/conf.d/default.conf
else
  cp /etc/nginx/conf.d/nginx-http.conf /etc/nginx/conf.d/default.conf
fi
exec nginx -g "daemon off;"
