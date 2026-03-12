FROM node:22-bookworm-slim AS build
WORKDIR /app

# Workspace install (only frontend needed)
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json
RUN npm ci -w frontend

COPY frontend ./frontend
RUN npm run build -w frontend

FROM nginx:1.27-alpine AS runtime
COPY frontend/nginx-http.conf /etc/nginx/conf.d/nginx-http.conf
COPY frontend/nginx-https.conf /etc/nginx/conf.d/nginx-https.conf
COPY frontend/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80 443
ENTRYPOINT ["/entrypoint.sh"]

