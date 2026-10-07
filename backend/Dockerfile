FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci
COPY backend backend
RUN npm run --workspace=backend prisma:generate
RUN npm run --workspace=backend build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --omit=dev
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/node_modules/.prisma node_modules/.prisma
COPY backend/prisma backend/prisma
WORKDIR /app/backend

EXPOSE 4000
# ponytail: runs migrations on every boot, fine for a single-instance deploy;
# switch to a separate migrate step/job if this ever runs as more than one replica.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
