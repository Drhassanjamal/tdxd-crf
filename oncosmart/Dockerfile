# OncoSmart — Chemotherapy Unit (single container: API + built frontend)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production PORT=4000
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --omit=dev --workspace backend --include-workspace-root=false && npm cache clean --force
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/backend/database/migrations backend/database/migrations
COPY --from=build /app/frontend/dist frontend/dist
USER node
EXPOSE 4000
# Apply pending migrations, then start the API (which also serves the frontend)
CMD ["sh", "-c", "node backend/dist/database/migrate.js && node backend/dist/src/server.js"]
