# Provider Setup Guides

Complete step-by-step instructions for adding accounts from each supported provider to CommonsProxy.

## Table of Contents

- [Google Cloud Code](#google-cloud-code)
- [Anthropic](#anthropic)
- [OpenAI](#openai)
- [GitHub Models](#github-models)
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

Happy coding! 🚀
