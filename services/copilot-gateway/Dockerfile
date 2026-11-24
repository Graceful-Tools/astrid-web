# Copilot gateway (ADEV-244). Build from this directory:
#   docker build -t astrid-copilot-gateway services/copilot-gateway
# The image carries the Copilot runtime (~200 MB, linux native package), which
# is exactly why this is a container and not part of the Vercel app.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
ENV NODE_ENV=production \
    PORT=8080 \
    COPILOT_TELEMETRY_DISABLED=true
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
# The runtime keeps nothing on disk (in-memory session filesystem), but give
# the non-root user a writable HOME for anything it insists on creating.
ENV HOME=/home/node
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
