#!/bin/sh
# Select nginx config by ENABLE_HTTPS (true = HTTPS, false = HTTP only).
set -e
if [ "${ENABLE_HTTPS}" = "true" ]; then
  cp /etc/nginx/conf.d/nginx-https.conf /etc/nginx/conf.d/default.conf
else
  cp /etc/nginx/conf.d/nginx-http.conf /etc/nginx/conf.d/default.conf
fi
exec nginx -g "daemon off;"
