FROM node:22-slim

# Set environment
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data

WORKDIR /app

# Copy package manifests
COPY package*.json ./

# Install production dependencies
RUN npm ci --omit=dev

# Copy application source code and self-hosted assets
COPY server.js ./
COPY src/ ./src/
COPY public/ ./public/

# Prepare data volume directory and ownership
RUN mkdir -p /data && chown -R node:node /data /app

USER node

# Declare data volume
VOLUME ["/data"]

EXPOSE 3000

CMD ["node", "server.js"]
