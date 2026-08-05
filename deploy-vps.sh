#!/bin/bash
# ViralClip AI — VPS Deployment Script
# Usage: bash deploy-vps.sh
#
# This script:
#   1. Installs Docker + Docker Compose (if not present)
#   2. Clones the repo
#   3. Sets up .env from user input
#   4. Builds and starts all services
#   5. Sets up Caddy for auto-HTTPS
#
# Run this on a fresh Ubuntu 22.04/24.04 VPS as root or sudo user.

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  ViralClip AI — VPS Deployment${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check if running as root or sudo
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Please run as root or with sudo:${NC}"
  echo "  sudo bash deploy-vps.sh"
  exit 1
fi

# ─────────────────────────────────────────────
# Step 1: Install Docker
# ─────────────────────────────────────────────
echo -e "${YELLOW}[1/6] Checking Docker installation...${NC}"
if ! command -v docker &> /dev/null; then
  echo -e "${YELLOW}Docker not found. Installing...${NC}"
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  echo -e "${GREEN}✓ Docker installed${NC}"
else
  echo -e "${GREEN}✓ Docker already installed: $(docker --version)${NC}"
fi

if ! docker compose version &> /dev/null; then
  echo -e "${RED}Docker Compose plugin not found. Please install it manually.${NC}"
  exit 1
fi

# ─────────────────────────────────────────────
# Step 2: Clone or update the repo
# ─────────────────────────────────────────────
APP_DIR="/opt/cliperpro"
echo -e "${YELLOW}[2/6] Setting up application...${NC}"

if [ -d "$APP_DIR" ]; then
  echo -e "${YELLOW}Updating existing app at $APP_DIR...${NC}"
  cd "$APP_DIR"
  git pull origin main || true
else
  echo -e "${YELLOW}Cloning repo to $APP_DIR...${NC}"
  git clone https://github.com/RF-Project9/Cliperpro.git "$APP_DIR"
  cd "$APP_DIR"
fi

echo -e "${GREEN}✓ Application ready${NC}"

# ─────────────────────────────────────────────
# Step 3: Configure environment
# ─────────────────────────────────────────────
echo -e "${YELLOW}[3/6] Configuring environment...${NC}"

if [ ! -f ".env" ]; then
  echo ""
  echo -e "${BLUE}Please provide the following configuration:${NC}"

  # Generate random DB password
  DB_PASSWORD=$(openssl rand -hex 16)
  echo -e "${GREEN}✓ Generated DB password: $DB_PASSWORD${NC}"

  # Ask for OpenAI API key
  read -p "OpenAI API Key (sk-...): " OPENAI_KEY
  read -p "Domain name (e.g. cliperpro.yourdomain.com, or press Enter to skip): " DOMAIN

  # Ask for YouTube cookies (optional, can be added later)
  read -p "YouTube cookies (base64, or press Enter to skip): " YT_COOKIES

  cat > .env << EOF
# Database
POSTGRES_PASSWORD=$DB_PASSWORD

# OpenAI
OPENAI_API_KEY=$OPENAI_KEY
OPENAI_MODEL=gpt-4o-mini

# YouTube cookies (for video downloads)
YOUTUBE_COOKIES=$YT_COOKIES

# Domain (for Caddy HTTPS)
DOMAIN=${DOMAIN:-localhost}
EOF

  echo -e "${GREEN}✓ .env created${NC}"
else
  echo -e "${GREEN}✓ .env already exists${NC}"
fi

# ─────────────────────────────────────────────
# Step 4: Setup Caddy domain
# ─────────────────────────────────────────────
echo -e "${YELLOW}[4/6] Configuring Caddy reverse proxy...${NC}"

DOMAIN=$(grep "^DOMAIN=" .env | cut -d'=' -f2)

if [ -n "$DOMAIN" ] && [ "$DOMAIN" != "localhost" ]; then
  cat > Caddyfile << EOF
$DOMAIN {
    reverse_proxy app:3000 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
    request_body {
        max_size 500MB
    }
    timeouts {
        read 5m
        write 5m
        idle 5m
    }
}
EOF
  echo -e "${GREEN}✓ Caddy configured for domain: $DOMAIN${NC}"
  echo -e "${YELLOW}  Make sure your domain's A record points to this server's IP${NC}"
else
  cat > Caddyfile << EOF
:80 {
    reverse_proxy app:3000
}
EOF
  echo -e "${GREEN}✓ Caddy configured for HTTP (no domain)${NC}"
fi

# ─────────────────────────────────────────────
# Step 5: Build and start services
# ─────────────────────────────────────────────
echo -e "${YELLOW}[5/6] Building and starting services...${NC}"
echo -e "${YELLOW}  (This takes 5-10 minutes for first build)${NC}"

docker compose build
docker compose up -d

echo -e "${GREEN}✓ Services started${NC}"

# ─────────────────────────────────────────────
# Step 6: Run database migration
# ─────────────────────────────────────────────
echo -e "${YELLOW}[6/6] Running database migration...${NC}"

# Wait for app to be ready
echo -e "${YELLOW}  Waiting for app to start...${NC}"
sleep 15

# Push database schema
docker compose exec app bun run db:deploy || true

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  ✓ DEPLOYMENT COMPLETE!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Get server IP
SERVER_IP=$(curl -s ifconfig.me || echo "YOUR_SERVER_IP")

if [ -n "$DOMAIN" ] && [ "$DOMAIN" != "localhost" ]; then
  echo -e "${BLUE}Your app is live at:${NC}"
  echo -e "${GREEN}  https://$DOMAIN${NC}"
else
  echo -e "${BLUE}Your app is live at:${NC}"
  echo -e "${GREEN}  http://$SERVER_IP${NC}"
fi

echo ""
echo -e "${BLUE}Useful commands:${NC}"
echo "  View logs:      docker compose logs -f app"
echo "  Restart:        docker compose restart app"
echo "  Stop:           docker compose down"
echo "  Update:         git pull && docker compose up -d --build"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. Point your domain's A record to: $SERVER_IP"
echo "  2. Wait 5-10 min for SSL certificate (automatic)"
echo "  3. Open the app URL and add your OpenAI key in Settings"
echo ""
