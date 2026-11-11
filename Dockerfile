# LanAtlas: one container (API + web). Data in /data (volume).
FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund
COPY server server
COPY web web
RUN npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim
WORKDIR /app
# ping for the PING checks; openssl for Prisma.
RUN apt-get update && apt-get install -y --no-install-recommends iputils-ping openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production DATA_DIR=/data HOST=0.0.0.0 PORT=8080
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/server/package.json server/
COPY --from=build /app/server/prisma server/prisma
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
VOLUME /data
EXPOSE 8080
WORKDIR /app/server
CMD ["node", "dist/main.js"]
