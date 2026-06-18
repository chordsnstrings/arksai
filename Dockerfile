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
# git + ripgrep are functional requirements (clone/push, grep tool).
# python3 + pip + venv are also functional, NOT just build-time: the canvas static
# preview serves apps with `python3 -m http.server` (canvasExport.ts) and the agent
# builds/previews/publishes Python apps (`python3`/`pip`). The build stage had python3
# but the runtime stage did not — so static previews silently never bound their port
# and every Python app was dead. python-is-python3 maps `python` → `python3` too.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ripgrep ca-certificates bash procps zip unzip curl jq openssh-client \
      python3 python3-pip python3-venv python-is-python3 \
      && rm -rf /var/lib/apt/lists/*
# doctl (DigitalOcean CLI) so the agent can manage infrastructure
ARG DOCTL_VERSION=1.120.0
RUN curl -sL "https://github.com/digitalocean/doctl/releases/download/v${DOCTL_VERSION}/doctl-${DOCTL_VERSION}-linux-amd64.tar.gz" \
      | tar -xz -C /usr/local/bin doctl && chmod +x /usr/local/bin/doctl
# Document-generation libraries available to agent workspaces via NODE_PATH
RUN npm install -g exceljs pdfkit docx xlsx pptxgenjs && npm cache clean --force
ENV NODE_PATH=/usr/local/lib/node_modules
WORKDIR /app
# Headless Chromium for the UI render verification (Playwright), installed to a
# shared path the non-root `node` user can read. Done BEFORE copying app code so
# this heavy layer stays cached across code-only redeploys (the 2-min
# auto-deploy must not re-download Chromium each time). Non-fatal: the UI check
# degrades gracefully when the browser is unavailable, so a failed/slow browser
# install can never strand a deploy.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN ( npx --yes playwright@1.60.0 install --with-deps chromium && chmod -R a+rx /ms-playwright ) \
      || echo "WARN: Chromium install failed — UI render verification will be skipped at runtime."
# LibreOffice (headless) for HIGH-FIDELITY .pptx/.docx → PDF rendering in the deliverable
# visual-QC gate. OPTIONAL + non-fatal: the gate falls back to the HTML/preview render when
# absent, so a failed install never strands a deploy. Cached before the app copy.
RUN ( apt-get update && apt-get install -y --no-install-recommends \
        libreoffice-impress libreoffice-calc libreoffice-writer \
        && rm -rf /var/lib/apt/lists/* ) \
      || echo "WARN: LibreOffice install failed — pptx/docx fidelity rendering falls back to HTML preview."
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
