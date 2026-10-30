# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

FROM dependencies AS build
COPY . .
RUN npm run build

# A imagem da API leva só as dependências de produção (sem vitest, tsx, supertest ou typescript).
FROM dependencies AS production-dependencies
RUN npm prune --omit=dev

FROM nginx:1.27-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 CMD wget -qO- http://127.0.0.1/healthz || exit 1

# A API é o estágio final para plataformas que constroem o Dockerfile sem indicar target.
FROM node:22-bookworm-slim AS api
ENV NODE_ENV=production PORT=3333 DATABASE_PATH=/data/fideliza.db
WORKDIR /app/apps/api
COPY --from=production-dependencies /app/node_modules /app/node_modules
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/src/database/schema.sql ./src/database/schema.sql
RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 3333
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 CMD ["node","-e","fetch('http://127.0.0.1:3333/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node","dist/server.js"]
