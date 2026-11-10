FROM node:24-bookworm-slim AS build
WORKDIR /app/copilot-kit
COPY copilot-kit/ ./
RUN npm ci --ignore-scripts && npm run build

WORKDIR /app/pqm-cnc-frontend
COPY pqm-cnc-frontend/package*.json pqm-cnc-frontend/.npmrc ./
RUN npm ci --ignore-scripts
COPY pqm-cnc-frontend/ ./
ENV NEXT_PUBLIC_DATA_API_URL=/backend \
    PQM_BACKEND_ORIGIN=http://backend:8000 \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app/pqm-cnc-frontend
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PQM_BACKEND_ORIGIN=http://backend:8000
COPY --from=build --chown=node:node /app/pqm-cnc-frontend ./
RUN mkdir -p data/MachiningData data/pqm && chown -R node:node data
USER node
EXPOSE 3001
CMD ["npm", "start", "--", "--hostname", "0.0.0.0"]
