#!/usr/bin/env bash
#
# CommonsProxy Auto-Configuration Script
# Sets up CommonsProxy and configures Claude Code CLI to use it.
#
# Usage:
#   chmod +x setup.sh
#   ./setup.sh
#
# Environment variables (all optional):
#   PORT            - Server port (default: 8080)
#   API_KEY         - API key to protect the proxy (default: none)
#   WEBUI_PASSWORD  - Password for WebUI (default: none)
#   STRATEGY        - Account selection strategy: sticky|round-robin|hybrid (default: hybrid)
#

set -euo pipefail

# ──────────────────────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="${HOME}/.config/commons-proxy"
CONFIG_FILE="${CONFIG_DIR}/config.json"
ACCOUNTS_FILE="${CONFIG_DIR}/accounts.json"
CLAUDE_CONFIG_DIR="${HOME}/.claude"
CLAUDE_CONFIG_FILE="${CLAUDE_CONFIG_DIR}/settings.json"
DEFAULT_PORT="${PORT:-8080}"
MIN_NODE_VERSION=18

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# ──────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────
info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; }
header()  { echo -e "\n${BOLD}${CYAN}── $* ──${NC}\n"; }

check_command() {
    command -v "$1" &>/dev/null
}

# ──────────────────────────────────────────────────────────────
# Pre-flight Checks
# ──────────────────────────────────────────────────────────────
header "CommonsProxy Setup"

echo -e "${BOLD}CommonsProxy v2.1.0${NC} - Multi-provider AI proxy for Claude Code CLI"
echo ""

# 1. Check Node.js
header "Checking Prerequisites"

if ! check_command node; then
    error "Node.js is not installed."
    echo "  Install Node.js >= ${MIN_NODE_VERSION} from https://nodejs.org/"
    echo "  Or use nvm: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash"
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt "$MIN_NODE_VERSION" ]; then
    error "Node.js version $(node -v) is too old. Need >= v${MIN_NODE_VERSION}."
    echo "  Update Node.js: https://nodejs.org/"
    exit 1
fi
success "Node.js $(node -v)"

# 2. Check npm
if ! check_command npm; then
    error "npm is not installed."
    exit 1
fi
success "npm $(npm -v)"

# 3. Check git (optional, for updates)
if check_command git; then
    success "git $(git --version | cut -d' ' -f3)"
else
    warn "git not found. Updates via git pull won't work."
fi

# ──────────────────────────────────────────────────────────────
# Install Dependencies
# ──────────────────────────────────────────────────────────────
header "Installing Dependencies"

if [ -f "${SCRIPT_DIR}/package.json" ]; then
    info "Running npm install..."
    cd "$SCRIPT_DIR"
    npm install --no-fund --no-audit 2>&1 | tail -3
    success "Dependencies installed"
else
    error "package.json not found in ${SCRIPT_DIR}"
    exit 1
fi

# ──────────────────────────────────────────────────────────────
# Configuration Directory
# ──────────────────────────────────────────────────────────────
header "Setting Up Configuration"

# Create config directory
if [ ! -d "$CONFIG_DIR" ]; then
    mkdir -p "$CONFIG_DIR"
    info "Created config directory: ${CONFIG_DIR}"
fi

# Create default config if it doesn't exist
if [ ! -f "$CONFIG_FILE" ]; then
    cat > "$CONFIG_FILE" <<EOF
{
  "apiKey": "${API_KEY:-}",
  "webuiPassword": "${WEBUI_PASSWORD:-}",
  "debug": false,
  "logLevel": "info",
  "maxRetries": 5,
  "maxAccounts": 10,
  "accountSelection": {
    "strategy": "${STRATEGY:-hybrid}"
  }
}
EOF
    success "Created default config: ${CONFIG_FILE}"
else
    success "Config file already exists: ${CONFIG_FILE}"
    info "To reset, delete ${CONFIG_FILE} and re-run this script."
fi

# Create accounts file if it doesn't exist
if [ ! -f "$ACCOUNTS_FILE" ]; then
    cat > "$ACCOUNTS_FILE" <<EOF
{
  "accounts": [],
  "settings": {},
  "activeIndex": 0
}
EOF
    success "Created accounts file: ${ACCOUNTS_FILE}"
else
    # Count existing accounts
    ACCOUNT_COUNT=$(node -e "
        try {
            const data = require('${ACCOUNTS_FILE}');
            const accounts = data.accounts || [];
            console.log(accounts.length);
        } catch { console.log(0); }
    " 2>/dev/null || echo "0")
    success "Accounts file exists with ${ACCOUNT_COUNT} account(s)"
fi

# ──────────────────────────────────────────────────────────────
# Configure Claude Code CLI
# ──────────────────────────────────────────────────────────────
header "Configuring Claude Code CLI"

# Check if Claude Code is installed
if check_command claude; then
    success "Claude Code CLI found: $(claude --version 2>/dev/null || echo 'version unknown')"
else
    warn "Claude Code CLI not found in PATH."
    echo "  Install it from: https://docs.anthropic.com/en/docs/claude-code"
    echo "  Continuing setup anyway (CLI config will be created)..."
fi

# Create Claude config directory
if [ ! -d "$CLAUDE_CONFIG_DIR" ]; then
    mkdir -p "$CLAUDE_CONFIG_DIR"
    info "Created Claude config directory: ${CLAUDE_CONFIG_DIR}"
fi

# Determine the proxy URL
PROXY_URL="http://127.0.0.1:${DEFAULT_PORT}"

# Check if Claude settings already exist and have proxy configured
ALREADY_CONFIGURED=false
if [ -f "$CLAUDE_CONFIG_FILE" ]; then
    CURRENT_BASE_URL=$(node -e "
        try {
            const data = JSON.parse(require('fs').readFileSync('${CLAUDE_CONFIG_FILE}', 'utf8'));
            console.log((data.env && data.env.ANTHROPIC_BASE_URL) || '');
        } catch { console.log(''); }
    " 2>/dev/null || echo "")
    
    if [ "$CURRENT_BASE_URL" = "$PROXY_URL" ]; then
        ALREADY_CONFIGURED=true
        success "Claude Code CLI already configured to use proxy at ${PROXY_URL}"
    elif [ -n "$CURRENT_BASE_URL" ]; then
        warn "Claude Code CLI points to different URL: ${CURRENT_BASE_URL}"
        echo -n "  Overwrite with ${PROXY_URL}? [y/N] "
        read -r OVERWRITE
        if [[ "$OVERWRITE" =~ ^[Yy]$ ]]; then
            ALREADY_CONFIGURED=false
        else
            ALREADY_CONFIGURED=true
            info "Keeping existing configuration."
        fi
    fi
fi

if [ "$ALREADY_CONFIGURED" = false ]; then
    # Read existing config or start fresh
    if [ -f "$CLAUDE_CONFIG_FILE" ]; then
        CLAUDE_CONFIG=$(cat "$CLAUDE_CONFIG_FILE")
    else
        CLAUDE_CONFIG='{}'
    fi
    
    # Update/create the config with proxy settings
    node -e "
        const fs = require('fs');
        let config = {};
        try {
            config = JSON.parse(fs.readFileSync('${CLAUDE_CONFIG_FILE}', 'utf8'));
        } catch {}
        
        if (!config.env) config.env = {};
        config.env.ANTHROPIC_BASE_URL = '${PROXY_URL}';
        config.env.ANTHROPIC_AUTH_TOKEN = '${API_KEY:-sk-commons-proxy}';
        
        fs.writeFileSync('${CLAUDE_CONFIG_FILE}', JSON.stringify(config, null, 2));
    " 2>/dev/null
    
    success "Claude Code CLI configured to use proxy at ${PROXY_URL}"
fi

# ──────────────────────────────────────────────────────────────
# Port Check
# ──────────────────────────────────────────────────────────────
header "Checking Port Availability"

if lsof -i ":${DEFAULT_PORT}" &>/dev/null 2>&1; then
    PID=$(lsof -ti ":${DEFAULT_PORT}" 2>/dev/null | head -1)
    warn "Port ${DEFAULT_PORT} is already in use (PID: ${PID})"
    echo "  CommonsProxy might already be running, or another service is using this port."
    echo "  To use a different port: PORT=9090 ./setup.sh"
else
    success "Port ${DEFAULT_PORT} is available"
fi

# ──────────────────────────────────────────────────────────────
# Summary
# ──────────────────────────────────────────────────────────────
header "Setup Complete"

echo -e "${BOLD}Configuration files:${NC}"
echo "  Proxy config:    ${CONFIG_FILE}"
echo "  Accounts:        ${ACCOUNTS_FILE}"
echo "  Claude CLI:      ${CLAUDE_CONFIG_FILE}"
echo ""
echo -e "${BOLD}Next steps:${NC}"
echo ""

# Check if we have accounts
if [ "${ACCOUNT_COUNT:-0}" -eq 0 ]; then
    echo "  1. Add an account (choose one):"
    echo ""
    echo "     ${CYAN}# Google Cloud Code (OAuth):${NC}"
    echo "     npm run accounts:add"
    echo ""
    echo "     ${CYAN}# Via WebUI (start server first, then open browser):${NC}"
    echo "     npm start"
    echo "     open http://127.0.0.1:${DEFAULT_PORT}"
    echo ""
    echo "  2. Start the proxy:"
    echo "     npm start"
    echo ""
else
    echo "  1. Start the proxy:"
    echo "     npm start"
    echo ""
fi

echo "  Once running, use Claude Code normally:"
echo "     ${CYAN}claude${NC}"
echo ""

if [ -n "${API_KEY:-}" ]; then
    echo -e "  ${YELLOW}API Key protection is enabled.${NC}"
    echo "  Claude Code is configured with the matching key."
    echo ""
fi

if [ -n "${WEBUI_PASSWORD:-}" ]; then
    echo -e "  ${YELLOW}WebUI password protection is enabled.${NC}"
    echo ""
fi

echo -e "${BOLD}Useful commands:${NC}"
echo "  npm start                        Start the proxy server"
echo "  npm start -- --strategy=sticky   Start with sticky strategy (best for caching)"
echo "  npm start -- --fallback          Enable model fallback"
echo "  npm start -- --debug             Enable debug logging"
echo "  npm run accounts                 Interactive account management"
echo "  npm run accounts:list            List configured accounts"
echo "  npm test                         Run tests (server must be running)"
echo ""
echo -e "${GREEN}${BOLD}CommonsProxy is ready!${NC}"
