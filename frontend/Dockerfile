FROM node:22-bookworm-slim AS build
WORKDIR /app

# Workspace install (only frontend needed)
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json
RUN npm ci -w frontend

COPY frontend ./frontend
RUN npm run build -w frontend

FROM nginx:1.27-alpine AS runtime
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80

