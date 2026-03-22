# ============================================
# GS_ImproveSFAgent — Production Dockerfile
# Multi-stage build for minimal image size
# ============================================

# Stage 1: Install dependencies and build
FROM node:20-alpine AS builder

WORKDIR /app

# Install build tools needed for native addons (better-sqlite3)
RUN apk add --no-cache python3 make g++ gcc

# Copy package files first for better caching
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Stage 2: Production image
FROM node:20-alpine AS production

WORKDIR /app

# Install build tools for native addon rebuild
RUN apk add --no-cache python3 make g++ gcc

# Install only production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Remove build tools to keep image smaller
RUN apk del python3 make g++ gcc

# Copy built output from builder
COPY --from=builder /app/dist ./dist

# Create data directory for SQLite volume mount
RUN mkdir -p /data && chown -R node:node /data

# Set environment variables
ENV NODE_ENV=production
ENV PORT=5000
ENV DATABASE_PATH=/data/gs_improvesfagent.db

# Use non-root user for security
USER node

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/api/health || exit 1

# Start the production server
CMD ["node", "dist/index.cjs"]
