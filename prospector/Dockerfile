# Universal container image — works on Render, Railway, Fly.io, Cloud Run, a VPS, etc.
FROM node:20-slim

WORKDIR /app

# Install deps first for better layer caching
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# App source
COPY . .

# Leads persist here — mount a volume at /data on your host to keep them.
ENV DATA_DIR=/data
RUN mkdir -p /data
VOLUME ["/data"]

# Hosts (DigitalOcean, Render, etc.) inject their own PORT at runtime, and the
# app honors it (falling back to 4317 locally when PORT is unset). We do NOT pin
# ENV PORT here so the host's port always wins and routing/health checks match.
EXPOSE 4317

CMD ["npm", "start"]
