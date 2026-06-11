# ---- build stage ----
FROM node:22-bookworm-slim AS build
# build tools in case better-sqlite3 needs to compile from source
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- runtime stage ----
FROM node:22-bookworm-slim
# git + ripgrep are functional requirements (clone/push, grep tool)
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ripgrep ca-certificates bash procps && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    CLIENT_DIST=/app/client/dist
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/dist/server/src/index.js"]
