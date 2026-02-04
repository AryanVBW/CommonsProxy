# Changelog

All notable changes to CommonsProxy will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-02-05

### 🎉 Major Release: Multi-Provider Support

CommonsProxy now supports multiple AI providers beyond Google Cloud Code, transforming it into a true universal AI proxy gateway. This major release enables you to add accounts from Anthropic, OpenAI, and GitHub Models alongside Google Cloud Code, with intelligent load balancing and automatic failover.

#### Added

**Multi-Provider Authentication System**
- Provider abstraction layer with `BaseProvider` class for extensibility
- **Anthropic API support** (API Key authentication)
  - Models: `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022`, `claude-3-opus-20240229`
  - Rate limit detection via HTTP 429 and error body parsing
  - Direct access to Anthropic's Claude API
- **OpenAI API support** (API Key authentication)
  - Models: `gpt-4-turbo-preview`, `gpt-4`, `gpt-3.5-turbo`
  - Custom endpoint support for Azure OpenAI Service
  - Self-hosted API compatibility (vLLM, LM Studio, etc.)
  - Rate limit detection via headers and error parsing
- **GitHub Models support** (Personal Access Token authentication)
  - Access to GitHub Marketplace models
  - GitHub API rate limit integration (5,000-15,000 req/hour)
  - Beta program support
- Provider-specific credential validation before account creation
- Provider registry system for dynamic provider management

**Enhanced Web Management Console**
- Provider selection dropdown in Add Account modal (dynamically populated from `/api/providers`)
- Color-coded provider badges for visual identification:
  - Google Cloud Code: Blue (#4285f4)
  - Anthropic: Orange (#d97706)
  - OpenAI: Green (#10b981)
  - GitHub Models: Indigo (#6366f1)
- Real-time credential validation during account setup
- Provider-specific configuration options:
  - Custom API endpoint toggle for OpenAI (Azure OpenAI support)
  - Manual OAuth code input for headless servers (Google)
- Account table "Source" column renamed to "Provider"
- Dashboard charts now color-code data by provider

**New API Endpoints**
- `GET /api/providers` - List all available providers with metadata
- `POST /api/providers/:id/validate` - Validate credentials before adding account
- `POST /api/accounts/add` - Unified account creation endpoint with provider support

**Documentation**
- Complete provider setup guides in `docs/PROVIDERS.md` with step-by-step instructions
- Developer onboarding guide in `CONTRIBUTING.md` with "Adding a New Provider" section
- Docker deployment documentation
- Enhanced CLI help text with provider examples

**Infrastructure**
- Docker support with multi-stage builds for optimized images
- Multi-architecture Docker builds (linux/amd64, linux/arm64)
- Docker Compose configuration for local development
- Enhanced GitHub Actions workflows:
  - Automated testing on pull requests (Node 18, 20, 22)
  - Docker image builds and push to GitHub Container Registry
  - npm publish with provenance attestation

#### Changed

**Backend Architecture**
- Account schema extended with new fields:
  - `provider`: Provider identifier (`'google'` | `'anthropic'` | `'openai'` | `'github'`)
  - `customApiEndpoint`: Optional custom API endpoint URL (for OpenAI/Azure)
- `AccountManager` now uses provider-aware token management
- Request routing system now provider-aware (selects correct API client based on account)
- Credentials management refactored to support multiple authentication types

**Frontend**
- Add Account modal completely redesigned with provider-specific forms
- Account list displays provider badges instead of generic "Source" column
- Dashboard charts use provider-specific colors for data visualization
- Account actions now provider-aware (e.g., "Refresh Token" only for OAuth providers)

**Documentation**
- README.md rewritten with multi-provider focus
- "How It Works" section updated to show multiple provider backends
- "Link Account(s)" section expanded with four provider subsections
- Installation guide now includes Docker option (Option 3)
- CLI help text (`bin/cli.js`) enhanced with provider examples

**Configuration**
- New constants in `src/constants.js`:
  - `PROVIDER_CONFIG`: Provider metadata and configuration
  - `PROVIDER_NAMES`: Human-readable provider names
  - `PROVIDER_COLORS`: UI color scheme for each provider

#### Fixed

None (feature release, no bug fixes in this version)

#### Migration

✅ **Fully Backward Compatible** - No user action required

- Existing Google OAuth accounts automatically migrated with `provider: 'google'`
- Migration handled transparently in `src/account-manager/storage.js` via `detectProviderFromSource()`
- All existing features preserved (account selection strategies, rate limiting, caching)
- Existing accounts.json format supported alongside new schema

#### Security

- Docker images run as non-root user (`node`)
- Multi-stage Docker builds minimize attack surface
- npm packages published with provenance attestation
- Credential validation prevents invalid API keys from being stored

#### Developer Notes

**Adding a New Provider**: See `CONTRIBUTING.md` for step-by-step guide to implementing a new provider

**Provider Architecture**:
```
Request → AccountManager → Account.provider → ProviderRegistry
                                                      ↓
                              [GoogleProvider | AnthropicProvider | OpenAIProvider | GitHubProvider]
                                                      ↓
                                          Provider-specific API client
```

**Key Files Changed**:
- `src/providers/` - New provider system (8 files)
- `src/account-manager/storage.js` - Extended account schema
- `src/account-manager/credentials.js` - Provider-aware auth
- `src/webui/index.js` - Provider management APIs
- `public/js/components/add-account-modal.js` - Provider selection UI

---

## [1.2.6] - 2025-01-29

### Changed
- Updated default haiku model to `claude-sonnet-4-5` and `gemini-3-flash`

### Fixed
- Console warnings in WebUI
- Windows callback port issues

## [1.2.5] - 2025-01-20

### Added
- Cache control field stripping for compatibility with Cloud Code API
- Cross-model thinking signature detection and recovery

### Fixed
- Cache control errors when using prompt caching with Claude Code CLI

## [1.2.0] - 2025-01-15

### Added
- Web Management UI with Alpine.js
- Real-time dashboard with quota visualization
- Live log streaming via Server-Sent Events
- Account management interface (add/remove/refresh)
- Server configuration editor

### Changed
- Rebranded from Antigravity Proxy to CommonsProxy
- Improved account selection strategies (hybrid, sticky, round-robin)

## [1.1.0] - 2025-01-10

### Added
- Multi-account support with automatic load balancing
- Account selection strategies (sticky, round-robin, hybrid)
- Prompt caching support with session ID derivation
- Model fallback system

### Fixed
- Rate limit handling improvements
- Token refresh reliability

## [1.0.0] - 2025-01-01

### Added
- Initial release
- Google Cloud Code proxy support
- Anthropic Messages API compatibility
- OAuth 2.0 with PKCE authentication
- Streaming and non-streaming support
- Thinking model support

---

## Versioning

- **MAJOR** version for incompatible API changes
- **MINOR** version for new functionality (backward compatible)
- **PATCH** version for bug fixes (backward compatible)

## Links

- [Repository](https://github.com/AryanVBW/CommonsProxy)
- [Issues](https://github.com/AryanVBW/CommonsProxy/issues)
- [npm Package](https://www.npmjs.com/package/commons-proxy)
