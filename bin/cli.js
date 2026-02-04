#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read package.json for version
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')
);

const args = process.argv.slice(2);
const command = args[0];

function showHelp() {
  console.log(`
CommonsProxy v${packageJson.version}

Universal proxy server for Claude Code CLI - supports multiple AI providers.

USAGE:
  commons-proxy <command> [options]

COMMANDS:
  start                 Start the proxy server (default port: 8080)
  accounts              Manage accounts (interactive)
  accounts add          Add a new account (prompts for provider)
  accounts list         List all configured accounts
  accounts remove       Remove accounts interactively
  accounts verify       Verify account tokens are valid
  accounts clear        Remove all accounts

OPTIONS:
  --help, -h            Show this help message
  --version, -v         Show version number
  --strategy=<type>     Account selection strategy (sticky|round-robin|hybrid)
  --fallback            Enable model fallback when quota exhausted
  --debug               Enable debug logging
  --no-browser          Use manual code input for OAuth (headless servers)

ENVIRONMENT:
  PORT                  Server port (default: 8080)
  WEBUI_PASSWORD        Password protect WebUI (optional)
  STRATEGY              Account selection strategy (default: hybrid)
  FALLBACK              Enable model fallback (true|false)
  DEBUG                 Enable debug logging (true|false)

PROVIDERS:
  🔵 Google Cloud Code  OAuth 2.0 flow for Claude & Gemini models
  🟠 Anthropic          Direct API access via API key
  🟢 OpenAI             GPT models via API key (supports Azure)
  🟣 GitHub Models      GitHub marketplace access via Personal Access Token

EXAMPLES:
  # Start server with default settings
  commons-proxy start
  
  # Start with custom port and strategy
  PORT=3000 commons-proxy start --strategy=round-robin
  
  # Start with model fallback enabled
  commons-proxy start --fallback --debug
  
  # Add accounts from different providers
  commons-proxy accounts add              # Interactive (prompts for provider)
  commons-proxy accounts add --no-browser # Manual OAuth code input
  
  # List and verify accounts
  commons-proxy accounts list
  commons-proxy accounts verify

CONFIGURATION:
  Claude Code CLI (~/.claude/settings.json):
    {
      "env": {
        "ANTHROPIC_BASE_URL": "http://localhost:8080"
      }
    }
  
  Web Interface:
    http://localhost:8080 - Manage accounts, view stats, configure settings

DOCUMENTATION:
  Getting Started:  docs/PROVIDERS.md - Setup guides for all providers
  Contributing:     CONTRIBUTING.md - Developer onboarding guide
  GitHub:           https://github.com/AryanVBW/CommonsProxy
  npm:              https://www.npmjs.com/package/commons-proxy
`);
}

function showVersion() {
  console.log(packageJson.version);
}

async function main() {
  // Handle flags
  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }

  if (args.includes('--version') || args.includes('-v')) {
    showVersion();
    process.exit(0);
  }

  // Handle commands
  switch (command) {
    case 'start':
    case undefined:
      // Default to starting the server
      await import('../src/index.js');
      break;

    case 'accounts': {
      // Pass remaining args to accounts CLI
      const subCommand = args[1] || 'add';
      process.argv = ['node', 'accounts-cli.js', subCommand, ...args.slice(2)];
      await import('../src/cli/accounts.js');
      break;
    }

    case 'help':
      showHelp();
      break;

    case 'version':
      showVersion();
      break;

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Run "commons-proxy --help" for usage information.');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
