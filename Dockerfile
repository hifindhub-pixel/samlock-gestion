FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
COPY web/package*.json web/
RUN npm ci && npm ci --prefix web
COPY . .
RUN npm run build --prefix web

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3001 DATA_DIR=/data
COPY package*.json ./
RUN npm ci --omit=dev
COPY server server
COPY --from=build /app/web/dist web/dist
VOLUME /data
EXPOSE 3001
CMD ["sh", "-c", "node server/seed.js; node server/index.js"]
