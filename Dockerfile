# Multi-stage build: compile TypeScript in a full node image, run on a slim one.
# node:sqlite is a built-in driver (no native module to compile), so no build toolchain is
# needed beyond `tsc` itself.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY config ./config

# --experimental-sqlite is a no-op (accepted, ignored) on Node versions where node:sqlite has
# already stabilized, and required on others within the >=22.5 range this image targets.
ENV NODE_OPTIONS=--experimental-sqlite

EXPOSE 4000
VOLUME ["/app/data"]

# PORT/DB_PATH/API_KEYS_FILE/RATE_LIMIT_PER_MIN all have defaults — see src/api/index.ts.
# Mount a real, git-ignored key file over /app/config/api-keys.json for anything beyond a demo.
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://localhost:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/api/index.js"]
