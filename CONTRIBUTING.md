# Contributing to CommonsProxy

Thank you for your interest in contributing to CommonsProxy! This guide will help you get started.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Adding a New Provider](#adding-a-new-provider)
- [Testing Guidelines](#testing-guidelines)
- [Documentation Standards](#documentation-standards)
- [Pull Request Process](#pull-request-process)
- [Code Style](#code-style)

## Code of Conduct

Be respectful, inclusive, and collaborative. We welcome contributions from everyone.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork**:
   ```bash
   git clone https://github.com/YOUR-USERNAME/CommonsProxy.git
   cd CommonsProxy
   ```
3. **Add upstream remote**:
   ```bash
   git remote add upstream https://github.com/AryanVBW/CommonsProxy.git
   ```
4. **Install dependencies**:
   ```bash
   npm install
   ```
5. **Start development server**:
   ```bash
   npm run dev:full  # Watches both CSS and server files
   ```

## Development Setup

### Prerequisites
- Node.js 18+ (`node --version`)
- npm 9+ (`npm --version`)
- Git

### Environment
Create `.env.local` for local development:
```env
PORT=8080
DEBUG=true
WEBUI_PASSWORD=dev-password
```

### Running Tests
```bash
# Terminal 1: Start server
npm start

# Terminal 2: Run tests
npm test

# Or run specific test
npm run test:signatures
```

## Adding a New Provider

This is the most common contribution type. Follow these steps carefully:

### Step 1: Create Provider Class

Create `src/providers/[provider-name]-provider.js`:

```javascript
import BaseProvider from './base-provider.js';
import { logger } from '../utils/logger.js';

export default class MyProvider extends BaseProvider {
    constructor() {
        super();
        this.name = 'My Provider';
        this.id = 'my-provider';
    }

    /**
     * Validate credentials before adding account
     * @param {Object} credentials - { apiKey, customEndpoint, etc. }
     * @returns {Promise<{valid: boolean, error?: string, metadata?: Object}>}
     */
    async validateCredentials(credentials) {
        try {
            // Test API call to validate key
            const response = await fetch(`${this.getEndpoint(credentials)}/v1/test`, {
                headers: { 'Authorization': `Bearer ${credentials.apiKey}` }
            });
            
            if (!response.ok) {
                return { valid: false, error: 'Invalid API key' };
            }
            
            const data = await response.json();
            return { 
                valid: true, 
                metadata: { username: data.username } 
            };
        } catch (error) {
            return { valid: false, error: error.message };
        }
    }

    /**
     * Get access token for API requests
     * @param {Object} account - Account object from accounts.json
     * @returns {Promise<string>} Access token
     */
    async getAccessToken(account) {
        // For API key providers, return the key directly
        return account.apiKey;
        
        // For OAuth providers, implement token refresh logic:
        // if (this.isTokenExpired(account)) {
        //     return await this.refreshToken(account);
        // }
        // return account.accessToken;
    }

    /**
     * Get quota information for account
     * @param {Object} account - Account object
     * @returns {Promise<Object>} Quota info { models: {...}, lastChecked }
     */
    async getQuotas(account) {
        try {
            const token = await this.getAccessToken(account);
            const response = await fetch(`${this.getEndpoint(account)}/v1/quota`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            const data = await response.json();
            return {
                models: {
                    'model-id': {
                        remainingFraction: data.remaining / data.total,
                        resetTime: data.resetAt
                    }
                },
                lastChecked: Date.now()
            };
        } catch (error) {
            logger.error(`[${this.name}] Failed to fetch quota:`, error);
            return null;
        }
    }

    /**
     * Parse rate limit information from error response
     * @param {Error} error - Error object
     * @returns {Object|null} { resetTime, retryAfter } or null
     */
    parseRateLimitError(error) {
        // Check if error is rate limit (429)
        if (error.response?.status === 429) {
            // Parse reset time from headers or error body
            const resetTime = error.response.headers['x-ratelimit-reset'];
            return {
                resetTime: resetTime ? parseInt(resetTime) * 1000 : Date.now() + 60000,
                retryAfter: 60
            };
        }
        return null;
    }

    /**
     * Get API endpoint (support custom endpoints)
     * @param {Object} accountOrCredentials - Account or credentials object
     * @returns {string} API endpoint URL
     */
    getEndpoint(accountOrCredentials) {
        return accountOrCredentials.customApiEndpoint || 'https://api.myprovider.com';
    }
}
```

### Step 2: Register Provider

Add to `src/providers/index.js`:

```javascript
import MyProvider from './my-provider-provider.js';

// Add to authProviders initialization (around line 28)
authProviders.set('my-provider', new MyProvider());

// Export class (around line 177)
export {
    GoogleProvider,
    AnthropicProvider,
    OpenAIProvider,
    GitHubProvider,
    MyProvider  // Add here
};
```

### Step 3: Add Configuration

Add to `src/constants.js` in `PROVIDER_CONFIG` object (around line 276):

```javascript
export const PROVIDER_CONFIG = {
    // ... existing providers ...
    'my-provider': {
        id: 'my-provider',
        name: 'My Provider',
        authType: 'api-key',  // or 'oauth', 'pat'
        apiEndpoint: 'https://api.myprovider.com',
        color: '#hexcolor',  // Brand color for UI (e.g., '#3b82f6')
        icon: 'my-provider',  // Icon identifier
        requiresProjectId: false
    }
};

// Also add to PROVIDER_NAMES (around line 317)
export const PROVIDER_NAMES = {
    // ... existing ...
    'my-provider': 'My Provider'
};

// And PROVIDER_COLORS (around line 325)
export const PROVIDER_COLORS = {
    // ... existing ...
    'my-provider': '#hexcolor'
};
```

### Step 4: Frontend Auto-Updates

✅ **No frontend changes needed!** The WebUI automatically:
- Fetches providers from `/api/providers` endpoint
- Renders provider dropdown in Add Account modal
- Shows color-coded badges using your configured color
- Validates credentials using your `validateCredentials()` method

### Step 5: Add Documentation

Add provider section to `docs/PROVIDERS.md`:

```markdown
## My Provider

### Overview
[Description of provider, what models it offers, pricing]

### Prerequisites
[What users need before setup - account creation, billing, etc.]

### Getting Your API Key
[Step-by-step instructions with exact URLs]

1. Visit https://myprovider.com/console
2. Navigate to API Keys section
3. Click "Create New Key"
4. Copy the key (starts with `mp-`)
5. Store securely

### Setup in CommonsProxy

**Via WebUI**:
1. Navigate to Accounts tab
2. Click "Add Account"
3. Select "My Provider" from dropdown
4. Paste API key
5. Click "Validate & Add"

**Via CLI**:
```bash
commons-proxy accounts add --provider=my-provider
```

### Available Models
[Table of models with capabilities]

| Model ID | Name | Context | Features |
|----------|------|---------|----------|
| `model-fast` | Fast Model | 8K | Quick responses |
| `model-pro` | Pro Model | 128K | Advanced reasoning |

### Rate Limits
[Quota information and how to check limits]

### Troubleshooting
[Common issues and solutions]
```

### Step 6: Add Tests (Optional but Recommended)

Create `tests/test-my-provider.cjs`:

```javascript
const { testProvider } = require('./helpers/provider-tester.cjs');

async function testMyProvider() {
    await testProvider({
        name: 'My Provider',
        providerId: 'my-provider',
        validCredentials: {
            apiKey: process.env.MY_PROVIDER_API_KEY
        },
        invalidCredentials: {
            apiKey: 'invalid-key'
        },
        testModel: 'model-id'
    });
}

testMyProvider().catch(console.error);
```

### Step 7: Submit Pull Request

1. **Create feature branch**:
   ```bash
   git checkout -b feature/add-my-provider
   ```

2. **Commit changes**:
   ```bash
   git add src/providers/my-provider-provider.js
   git add src/providers/index.js
   git add src/constants.js
   git add docs/PROVIDERS.md
   git commit -m "feat: add My Provider support
   
   - Implement MyProvider class with API key auth
   - Add provider config to constants
   - Add documentation to PROVIDERS.md
   - Add integration tests
   
   Closes #XXX"
   ```

3. **Push and create PR**:
   ```bash
   git push origin feature/add-my-provider
   ```

4. **Open PR on GitHub** with description:
   - What provider you're adding
   - Testing performed (include test output)
   - Documentation included
   - Any special considerations

## Testing Guidelines

### Manual Testing Checklist

Before submitting PR, verify:

- [ ] Provider validates valid credentials
- [ ] Provider rejects invalid credentials
- [ ] Account appears in WebUI accounts list
- [ ] Provider badge shows correct color
- [ ] Quota fetching works (if applicable)
- [ ] Rate limit detection works
- [ ] Requests route correctly through provider
- [ ] Error messages are clear and helpful

### Automated Testing

Run full test suite:
```bash
# Start server in one terminal
npm start

# Run tests in another terminal
npm test
```

Run specific provider test:
```bash
node tests/test-my-provider.cjs
```

## Documentation Standards

- **Code Comments**: Use JSDoc format for all public methods
- **README**: Update if adding major features
- **PROVIDERS.md**: Complete setup guide for new providers (mandatory)
- **CHANGELOG.md**: Add entry for next release (maintainers will handle)

**JSDoc Example**:
```javascript
/**
 * Validate credentials before adding account
 * @param {Object} credentials - Credentials object
 * @param {string} credentials.apiKey - API key from provider
 * @param {string} [credentials.customEndpoint] - Optional custom endpoint
 * @returns {Promise<{valid: boolean, error?: string}>} Validation result
 */
async validateCredentials(credentials) {
    // Implementation
}
```

## Pull Request Process

### Before Submitting

1. Run CSS build: `npm run build:css`
2. Run tests: `npm test`
3. Update documentation
4. Check code style (ESM, async/await)
5. Test locally with real accounts

### PR Title Format

Use conventional commits:
- `feat: add new feature`
- `fix: fix bug description`
- `docs: update documentation`
- `refactor: improve code structure`
- `test: add tests`
- `chore: update dependencies`

**Examples**:
- `feat: add Azure OpenAI custom endpoint support`
- `fix: handle rate limit retry-after header`
- `docs: improve provider setup instructions`

### PR Description Template

```markdown
## Description
[Clear description of what this PR does]

## Type of Change
- [ ] New provider
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update

## Testing
[Describe testing performed]
- [ ] Manual testing with real account
- [ ] Automated tests added/passing
- [ ] Tested on multiple Node.js versions

## Screenshots (if applicable)
[Add screenshots of WebUI changes]

## Checklist
- [ ] Code follows project style
- [ ] Documentation updated
- [ ] Tests added/passing
- [ ] No breaking changes (or documented)
```

### Review Process

- Maintainers review within 3-5 business days
- Address feedback promptly
- Squash commits if requested
- Be patient and respectful

## Code Style

### JavaScript/ESM

- **Module System**: ESM (import/export, not require)
- **Async**: Use async/await (not callbacks or raw promises)
- **Error Handling**: try/catch with specific error types
- **Logging**: Use `logger` from `utils/logger.js`

**Good Example**:
```javascript
import { logger } from '../utils/logger.js';
import { ApiError } from '../errors.js';

export async function fetchData(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new ApiError('Fetch failed', response.status);
        }
        const data = await response.json();
        logger.info('Data fetched successfully');
        return data;
    } catch (error) {
        logger.error('Failed to fetch data:', error);
        throw error;
    }
}
```

**Bad Example**:
```javascript
// ❌ Don't use CommonJS
const logger = require('./utils/logger');

// ❌ Don't use callbacks
function fetchData(url, callback) {
    fetch(url)
        .then(res => res.json())
        .then(data => callback(null, data))
        .catch(err => callback(err));
}

// ❌ Don't use console.log directly
console.log('Debug info');  // Use logger.debug() instead
```

### Naming Conventions

- **Files**: kebab-case (`my-provider.js`, `rate-limiter.js`)
- **Classes**: PascalCase (`MyProvider`, `AccountManager`)
- **Functions**: camelCase (`getAccessToken`, `validateCredentials`)
- **Constants**: UPPER_SNAKE_CASE (`API_ENDPOINT`, `MAX_RETRIES`)
- **Private methods**: prefix with underscore (`_refreshToken`)

### File Organization

```
src/
├── providers/          # Provider implementations
│   ├── base-provider.js
│   ├── google-provider.js
│   └── [new]-provider.js
├── account-manager/    # Account management
├── auth/               # Authentication
├── cloudcode/          # Cloud Code API client
├── format/             # Format conversion
├── modules/            # Feature modules
├── utils/              # Utilities
└── webui/              # Web management interface
```

## Questions?

- **Open a Discussion**: https://github.com/AryanVBW/CommonsProxy/discussions
- **File an Issue**: https://github.com/AryanVBW/CommonsProxy/issues
- **Email**: badrinarayanans@gmail.com

---

Thank you for contributing to CommonsProxy! 🎉

Every contribution, no matter how small, makes this project better for everyone.
