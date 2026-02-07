# Provider Setup Guides

Complete step-by-step instructions for adding accounts from each supported provider to CommonsProxy.

## Table of Contents

- [Google Cloud Code](#google-cloud-code)
- [Anthropic](#anthropic)
- [OpenAI](#openai)
- [GitHub Models](#github-models)
- [GitHub Copilot](#github-copilot)
- [ChatGPT Plus/Pro (Codex)](#chatgpt-pluspro-codex)
- [OpenRouter](#6-openrouter)
- [Troubleshooting](#troubleshooting)

---

## Google Cloud Code

### Overview

Google Cloud Code provides access to **Claude 3.5** and **Gemini 2.0** models via Google's infrastructure with real-time quota tracking.

**Authentication**: OAuth 2.0 with PKCE  
**Cost**: Free tier available, Pro ($9.99/month), Ultra ($19.99/month)  
**Quota Tracking**: ✅ Automatic via API

### Prerequisites

- Google account (any @gmail.com or Google Workspace account)
- Browser access (or SSH access for headless setup)

### Setup Methods

#### Method 1: WebUI OAuth (Recommended)

**Best for**: Desktop users with browser access

1. Start CommonsProxy:
   ```bash
   commons-proxy start
   ```

2. Open WebUI:
   - Navigate to `http://localhost:8080`
   - Go to **Accounts** tab

3. Add Account:
   - Click **Add Account** button
   - Select **Google Cloud Code** from provider dropdown
   - Click **Start OAuth Flow**

4. Authorize:
   - Popup window opens with Google OAuth screen
   - Sign in with your Google account
   - Grant permissions for Cloud Code access
   - Popup closes automatically on success

5. Verify:
   - Account appears in the accounts list
   - Subscription tier shown (Free/Pro/Ultra)
   - Quota bars display current usage

**Troubleshooting**:
- If popup is blocked: Check browser popup settings
- If OAuth fails: Try incognito mode to avoid cookie conflicts

---

#### Method 2: CLI OAuth (Desktop)

**Best for**: Terminal users on desktop

```bash
commons-proxy accounts add --provider=google
```

Browser opens automatically with OAuth URL. Complete authorization and return to terminal.

**Example Output**:
```
🔵 Adding Google Cloud Code account...
🌐 Opening browser for OAuth authorization...
✅ Authorization successful!
📧 Account added: user@gmail.com
🎯 Subscription: Pro
```

---

#### Method 3: CLI OAuth (Headless)

**Best for**: Remote servers, Docker containers, SSH sessions

```bash
commons-proxy accounts add --provider=google --no-browser
```

1. Copy the OAuth URL displayed in terminal
2. Open URL on your local machine's browser
3. Complete authorization
4. Copy the callback URL from browser address bar
5. Paste callback URL back into terminal

**Example Session**:
```bash
$ commons-proxy accounts add --provider=google --no-browser

🔵 Adding Google Cloud Code account (headless mode)...

📋 Copy this URL and open in your browser:
https://accounts.google.com/o/oauth2/v2/auth?client_id=...

After authorizing, paste the full callback URL here:
Callback URL: http://localhost:41241/callback?code=4/0AanRRrvD...

✅ Authorization successful!
📧 Account added: user@gmail.com
```

---

### Available Models

| Model ID | Display Name | Context | Thinking | Vision |
|----------|--------------|---------|----------|--------|
| `claude-sonnet-4-5` | Claude 3.5 Sonnet | 200K | ✅ | ✅ |
| `claude-opus-4-5` | Claude 3.5 Opus | 200K | ✅ Extended | ✅ |
| `gemini-3-flash` | Gemini 2.0 Flash | 1M | ✅ | ✅ |
| `gemini-3-pro-low` | Gemini 2.0 Pro (Low) | 2M | ✅ | ✅ |
| `gemini-3-pro-high` | Gemini 2.0 Pro (High) | 2M | ✅ Extended | ✅ |

### Subscription Tiers

- **Free**: ~500 requests/day, access to all models
- **Pro** ($9.99/month): ~2,000 requests/day, priority access
- **Ultra** ($19.99/month): ~5,000 requests/day, extended thinking

Tier automatically detected and displayed in WebUI.

---

## Anthropic

### Overview

Direct access to Anthropic's Claude API with official rate limits and billing.

**Authentication**: API Key  
**Cost**: Pay-as-you-go ([pricing](https://www.anthropic.com/pricing))  
**Quota Tracking**: ⚠️ Manual (check console)

### Prerequisites

- Anthropic account: [console.anthropic.com](https://console.anthropic.com)
- Payment method added (required for API access)

### Getting Your API Key

1. **Sign up**: Visit https://console.anthropic.com and create account

2. **Add Payment**: Settings → Billing → Add payment method

3. **Create API Key**:
   - Navigate to https://console.anthropic.com/settings/keys
   - Click "Create Key"
   - Name your key (e.g., "CommonsProxy")
   - **Copy key** (starts with `sk-ant-`) - shown only once!

⚠️ **Security**: Store securely, never commit to version control

### Setup in CommonsProxy

#### Via WebUI

1. Open `http://localhost:8080` → **Accounts** tab
2. Click **Add Account** → Select **Anthropic**
3. Enter API key
4. Click **Validate & Add**

#### Via CLI

```bash
commons-proxy accounts add --provider=anthropic
```

Prompts for API key interactively.

### Available Models

| Model ID | Display Name | Context | Best For |
|----------|--------------|---------|----------|
| `claude-3-5-sonnet-20241022` | Claude 3.5 Sonnet | 200K | General tasks |
| `claude-3-5-haiku-20241022` | Claude 3.5 Haiku | 200K | Fast, cost-effective |
| `claude-3-opus-20240229` | Claude 3 Opus | 200K | Maximum capability |

### Rate Limits

View your limits: https://console.anthropic.com/settings/limits

**Typical Tiers**:
- Free: 5 req/min, 40K tokens/min
- Build Tier 1: 50 req/min, 40K tokens/min
- Scale Tier 2: 50 req/min, 80K tokens/min

CommonsProxy auto-detects rate limits and fails over to other accounts.

---

## OpenAI

### Overview

Access GPT models via OpenAI API, with support for Azure OpenAI Service.

**Authentication**: API Key  
**Cost**: Pay-as-you-go  
**Custom Endpoints**: ✅ Supported (Azure OpenAI)

### Prerequisites

- OpenAI account: [platform.openai.com](https://platform.openai.com)
- Payment method (for usage beyond free trial)

### Getting Your API Key

1. **Sign up**: https://platform.openai.com/signup

2. **Add Payment**: Settings → Billing (if needed)

3. **Create API Key**:
   - Visit https://platform.openai.com/api-keys
   - Click "Create new secret key"
   - Name your key
   - **Copy key** (starts with `sk-`) - shown only once!

### Setup in CommonsProxy

#### Via WebUI

1. **Accounts** tab → **Add Account** → Select **OpenAI**
2. Enter API key
3. **Optional**: Toggle "Custom Endpoint" for Azure OpenAI
   - Example: `https://your-resource.openai.azure.com`
4. Click **Validate & Add**

#### Via CLI

```bash
# Standard OpenAI
commons-proxy accounts add --provider=openai

# Azure OpenAI
commons-proxy accounts add --provider=openai --endpoint=https://your-resource.openai.azure.com
```

### Available Models

| Model ID | Display Name | Context | Features |
|----------|--------------|---------|----------|
| `gpt-4-turbo-preview` | GPT-4 Turbo | 128K | Vision, JSON mode |
| `gpt-4` | GPT-4 | 8K | Reliable, classic |
| `gpt-3.5-turbo` | GPT-3.5 Turbo | 16K | Fast, affordable |

### Azure OpenAI

**Why Azure?** Enterprise compliance, private deployment, regional data residency

**Setup**:
1. Create Azure OpenAI resource in Azure Portal
2. Deploy models
3. Get endpoint URL and API key
4. Add to CommonsProxy with custom endpoint

### Rate Limits

**OpenAI Platform Tiers**:
- Free: 3 req/min
- Tier 1 ($5+ spent): 500 req/min
- Tier 2 ($50+ spent): 5,000 req/min

Check your tier: https://platform.openai.com/account/limits

---

## GitHub Models

### Overview

Access GitHub Marketplace models via GitHub's inference API (beta).

**Authentication**: Personal Access Token (PAT)  
**Cost**: Free during beta  
**Models**: Varies by region/account

### Prerequisites

- GitHub account
- Personal Access Token

### Getting a Personal Access Token

1. Visit https://github.com/settings/tokens

2. **Generate new token (classic)**

3. **Required scopes**:
   - ✅ `read:packages` (for model access)
   - ✅ `repo` (optional, if using private repos)

4. **Copy token** (starts with `ghp_`) - shown only once!

### Setup in CommonsProxy

#### Via WebUI

1. **Accounts** tab → **Add Account** → **GitHub Models**
2. Paste Personal Access Token
3. Click **Validate & Add**

#### Via CLI

```bash
commons-proxy accounts add --provider=github
```

### Available Models

Models vary by account and region. Common examples:
- GPT-4 (OpenAI)
- GPT-3.5 Turbo (OpenAI)
- Llama 2/3 (Meta)
- Mistral models

Check your access: https://github.com/marketplace/models

### Rate Limits

**GitHub API Rate Limits**:
- Standard: 5,000 requests/hour
- GitHub Pro/Enterprise: 15,000 requests/hour

CommonsProxy detects limits via headers and rotates accounts.

---

## Troubleshooting

### "Invalid credentials" Error

**Google**: Token expired → Re-authorize via WebUI (Accounts → Refresh)  
**Anthropic**: Check key at console.anthropic.com/settings/keys  
**OpenAI**: Verify key at platform.openai.com/api-keys  
**GitHub**: Check token hasn't expired at github.com/settings/tokens

### Rate Limit Issues

- View current limits in WebUI Dashboard
- Add more accounts from same/different providers
- Enable `--fallback` mode: `commons-proxy start --fallback`

### Connection Errors

1. Verify internet connectivity: `ping 8.8.8.8`
2. Check firewall rules (allow HTTPS outbound)
3. For custom endpoints: verify URL accessibility

### Model Not Available

- Ensure provider account has access to the model
- Check subscription tier (some models require paid plans)
- Verify model name matches provider's API

### Debug Mode

Enable detailed logging:
```bash
commons-proxy start --debug
```

Shows full API requests/responses and provider selection decisions.

---

## Getting Help

- **Documentation**: https://github.com/AryanVBW/CommonsProxy/tree/main/docs
- **Issues**: https://github.com/AryanVBW/CommonsProxy/issues
- **Discussions**: https://github.com/AryanVBW/CommonsProxy/discussions

When reporting issues:
1. Run with `--debug` flag
2. Copy relevant log output (redact API keys!)
3. Include OS, Node.js version, CommonsProxy version
4. Describe steps to reproduce

---

## Next Steps

1. Add your first account
2. Configure Claude Code CLI:
   ```json
   {
     "env": {
       "ANTHROPIC_BASE_URL": "http://localhost:8080"
     }
   }
   ```
3. Test: `claude-code "Hello!"`
4. Monitor in WebUI: `http://localhost:8080`

**Pro Tips**:
- Add multiple accounts for load balancing
- Mix providers for redundancy  
- Enable `--fallback` for automatic failover
- Monitor quota in WebUI dashboard

---

## GitHub Copilot

### Overview
- **Authentication**: GitHub Device Authorization Flow
- **Cost**: Requires active GitHub Copilot subscription ($10/month Individual, $19/month Business)
- **Quota Tracking**: ⚠️ Copilot rate limits (not exposed via API)

### Prerequisites
- GitHub account with an active **GitHub Copilot** subscription
- No API key needed — uses device authorization flow

### Setup

#### Method 1: WebUI (Recommended)
1. Open CommonsProxy WebUI at `http://localhost:8080`
2. Go to **Accounts** → **Add Account**
3. Select **GitHub Copilot** from the provider dropdown
4. Click **Connect GitHub Copilot**
5. A new window opens to `https://github.com/login/device`
6. Enter the **device code** shown in the modal
7. Authorize the application on GitHub
8. Account is automatically added once authorized

#### Method 2: CLI
```bash
# Add via CLI (interactive device auth flow)
commons-proxy accounts add --provider=copilot
```

### Available Models

| Model ID | Display Name | Context Window | Features |
|----------|-------------|----------------|----------|
| `gpt-4o` | GPT-4o | 128K | Vision |
| `gpt-4o-mini` | GPT-4o Mini | 128K | Vision |
| `gpt-4` | GPT-4 | 8K | - |
| `gpt-4-turbo` | GPT-4 Turbo | 128K | Vision |
| `claude-sonnet-4` | Claude Sonnet 4 | 200K | Thinking, Vision |
| `claude-3.5-sonnet` | Claude 3.5 Sonnet | 200K | Vision |
| `claude-haiku-3.5` | Claude Haiku 3.5 | 200K | Vision |
| `o1-preview` | o1 Preview | 128K | Reasoning |
| `o1-mini` | o1 Mini | 128K | Reasoning |
| `o3-mini` | o3 Mini | 128K | Reasoning |

### Rate Limits
GitHub Copilot has rate limits that vary by subscription tier:
- **Individual**: Standard rate limits
- **Business/Enterprise**: Higher rate limits

### How It Works
1. CommonsProxy initiates a GitHub Device Authorization flow
2. You authorize on GitHub's website with a one-time code
3. CommonsProxy receives a GitHub OAuth token
4. The GitHub token is used directly as Bearer auth for Copilot API requests
5. Copilot-specific headers (`Openai-Intent`, `x-initiator`) are added automatically

### Troubleshooting

**"Copilot access denied"**
- Ensure you have an active GitHub Copilot subscription
- Check your subscription at https://github.com/settings/copilot

**"Device code expired"**
- The device code expires after a few minutes
- Start the authorization flow again

**"Failed to get Copilot token"**
- Your GitHub token may have expired
- Remove and re-add the account

---

## ChatGPT Plus/Pro (Codex)

### Overview

Access OpenAI Codex models using your ChatGPT Plus or Pro subscription via OAuth.

**Authentication**: OAuth (Browser PKCE or Device Authorization)  
**Cost**: Requires active ChatGPT Plus ($20/month) or Pro ($200/month) subscription  
**Quota Tracking**: ⚠️ Subscription-based limits

> **Credits**: Authentication flow inspired by [opencode](https://github.com/nichochar/opencode)'s `codex.ts` plugin.

### Prerequisites

- Active **ChatGPT Plus** or **ChatGPT Pro** subscription
- No API key needed — uses OAuth authorization

### Setup

#### Method 1: WebUI Browser Auth (Recommended)
1. Open CommonsProxy WebUI at `http://localhost:8080`
2. Go to **Accounts** → **Add Account**
3. Select **ChatGPT Plus/Pro (Codex)** from the provider dropdown
4. Click **Connect via Browser**
5. A browser window opens to OpenAI's authorization page
6. Sign in with your ChatGPT account and authorize
7. Account is automatically added once authorized

#### Method 2: WebUI Device Auth (Headless/SSH)
1. Open CommonsProxy WebUI at `http://localhost:8080`
2. Go to **Accounts** → **Add Account**
3. Select **ChatGPT Plus/Pro (Codex)**
4. Click **Connect via Device Code**
5. Open `https://auth.openai.com/codex/device` in any browser
6. Enter the **user code** shown in the modal
7. Authorize the application
8. Account is automatically added once authorized

### Available Models

Models available depend on your subscription tier:

| Model ID | Display Name | Subscription | Features |
|----------|-------------|-------------|----------|
| `codex-mini` | Codex Mini | Plus/Pro | Fast coding |
| `o4-mini` | o4 Mini | Plus/Pro | Reasoning |
| `o3` | o3 | Pro | Advanced reasoning |

### How It Works
1. CommonsProxy initiates an OAuth flow (browser PKCE or device authorization)
2. You sign in with your ChatGPT account and authorize
3. CommonsProxy receives OAuth tokens (access + refresh)
4. Your ChatGPT Account ID is extracted from the JWT token
5. Requests are sent to the Codex API with proper `ChatGPT-Account-Id` header
6. Tokens are automatically refreshed when they expire

### Troubleshooting

**"Authorization failed"**
- Ensure you have an active ChatGPT Plus or Pro subscription
- Try using the device auth method if browser auth fails

**"Token refresh failed"**
- Your subscription may have expired
- Remove and re-add the account

**Port 1455 in use**
- Browser auth uses port 1455 for the OAuth callback
- Ensure no other application is using this port
- Use device auth as an alternative

---

## 6. OpenRouter

### Overview
- **Authentication**: API Key (Bearer token)
- **Cost**: Pay-per-use (credit-based)
- **Quota Tracking**: ✅ Credit-based via API
- **Models**: 100+ models from multiple providers (Claude, GPT, Gemini, Llama, Mistral, DeepSeek, etc.)

### Prerequisites
1. An [OpenRouter](https://openrouter.ai/) account
2. An API key from [openrouter.ai/keys](https://openrouter.ai/keys)

### Setup

#### Via WebUI (Recommended)
1. Start CommonsProxy: `commons-proxy start`
2. Open WebUI at `http://localhost:8080`
3. Click **Add Account**
4. Select **OpenRouter** as the provider
5. Enter your email/label and API key
6. Click **Add Account**

#### Via CLI
```bash
commons-proxy accounts add
# When prompted, choose to add a new account
# Select OpenRouter as provider
# Enter your API key
```

### Available Models

OpenRouter provides access to 100+ models. Some popular ones:

| Model ID | Name | Context | Features |
|----------|------|---------|----------|
| `anthropic/claude-sonnet-4` | Claude Sonnet 4 | 200K | Thinking, Vision |
| `anthropic/claude-3.5-sonnet` | Claude 3.5 Sonnet | 200K | Vision |
| `openai/gpt-4o` | GPT-4o | 128K | Vision |
| `openai/gpt-4o-mini` | GPT-4o Mini | 128K | Vision |
| `google/gemini-2.5-pro-preview` | Gemini 2.5 Pro | 1M | Thinking, Vision |
| `meta-llama/llama-3.1-405b-instruct` | Llama 3.1 405B | 131K | - |
| `deepseek/deepseek-r1` | DeepSeek R1 | 64K | Thinking |

See the full list at [openrouter.ai/models](https://openrouter.ai/models).

### Rate Limits
- Rate limits depend on your account tier and credit balance
- Free tier has lower rate limits
- Paid accounts get higher throughput

### Troubleshooting

**"Invalid API key"**
- Verify your key at [openrouter.ai/keys](https://openrouter.ai/keys)
- Ensure the key hasn't been revoked or expired
- Check that you have sufficient credits

**"Rate limit exceeded"**
- Wait for the rate limit window to reset
- Consider upgrading your OpenRouter plan
- Add multiple OpenRouter accounts for load balancing

**Models not showing**
- Ensure your API key has access to the models
- Some models may require a paid account
- Check [openrouter.ai/models](https://openrouter.ai/models) for availability

---

Happy coding! 🚀
