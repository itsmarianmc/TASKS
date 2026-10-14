FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 DATA_DIR=/app/data
RUN groupadd --gid 1001 taesks && useradd --uid 1001 --gid 1001 --no-create-home taesks && mkdir -p /app/data && chown 1001:1001 /app/data
COPY --from=build --chown=1001:1001 /app/.next/standalone ./
COPY --from=build --chown=1001:1001 /app/.next/static ./.next/static
COPY --from=build --chown=1001:1001 /app/public ./public
USER 1001:1001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(async r=>{const j=await r.json();process.exit(r.ok&&j.status==='ok'&&j.services.localDatabase==='ok'?0:1)}).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
