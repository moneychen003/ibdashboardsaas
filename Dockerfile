# Stage 1: Build React frontend
FROM node:20-alpine AS web-builder
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci --legacy-peer-deps
COPY web/ ./
RUN npm run build

# Stage 2: Python runtime
FROM python:3.11-slim
WORKDIR /app

# Install dependencies
RUN pip install --no-cache-dir flask

# Copy backend code
COPY server.py ./
COPY scripts/ ./scripts/
COPY web/dist/ ./web/dist/
COPY config/ ./config/
COPY data/ ./data/
COPY logs/ ./logs/
COPY backups/ ./backups/
COPY uploads/ ./uploads/
# Old static frontend removed; React build in web/dist is served by Flask
COPY web/dist/ ./web/dist/

# Copy built frontend from stage 1 (overwrite if any stale assets)
COPY --from=web-builder /app/web/dist/ ./web/dist/

ENV FLASK_APP=server.py
ENV PORT=8080

EXPOSE 8080

CMD ["python", "server.py"]
