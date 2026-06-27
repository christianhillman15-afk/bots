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

# Hosts inject PORT; default to 4317 for local `docker run`.
ENV PORT=4317
EXPOSE 4317

CMD ["npm", "start"]
