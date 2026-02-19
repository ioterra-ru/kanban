FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Workspace install (only backend needed)
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
RUN npm ci -w backend

FROM deps AS build
WORKDIR /app
COPY backend ./backend
# Prisma Client types must exist before TypeScript build.
RUN (cd backend && npx prisma generate) && npm run build -w backend

FROM node:22-bookworm-slim AS runtime
WORKDIR /app/backend
ENV NODE_ENV=production
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/backend/package.json ./package.json
COPY --from=build /app/backend/prisma ./prisma
COPY --from=build /app/backend/dist ./dist

EXPOSE 4000

# Run migrations on startup (with retries) and then start API
CMD ["sh", "-c", "i=0; until node ../node_modules/.bin/prisma migrate deploy; do i=$((i+1)); if [ $i -ge 30 ]; then echo 'prisma migrate deploy failed'; exit 1; fi; echo 'waiting for db...'; sleep 2; done; node dist/index.js"]

