# AGENTS.md

Guidance for AI coding agents working in this repository. See also `CLAUDE.md` for
full architectural documentation.

## Build & Run

```bash
npm install                  # Install deps + auto-build CSS (prepare hook)
npm start                    # Start server on port 8080
npm start -- --debug         # With debug logging
npm run dev:full             # Watch server + CSS (for frontend dev)
npm run build:css            # Rebuild Tailwind CSS (after editing input.css)
```

## Test Commands

```bash
# Offline unit tests (no server required)
node tests/test-strategies.cjs          # 89 tests  - account selection strategies
node tests/test-format-converters.cjs   # 85 tests  - format conversion
node tests/test-providers.cjs           # 97 tests  - provider registry, auth, JWT

# Integration tests (server must be running on :8080)
npm test                                # Run all integration tests
node tests/run-all.cjs <filter>         # Run matching tests only

# Single integration test
npm run test:streaming                  # One named suite
node tests/test-streaming.cjs           # Or run the file directly
```

There is no linter, formatter, or type checker configured. Style is enforced by convention.

## Project Essentials

- **Runtime**: Node.js >= 18, ESM (`"type": "module"` in package.json)
- **Dependencies**: Only 4 production deps: `express`, `cors`, `async-mutex`, `better-sqlite3`
- **Dev deps**: Tailwind/PostCSS/DaisyUI only (CSS build tooling)
- **Frontend**: Vanilla JS + Alpine.js + Tailwind CSS, no build step for JS

## Code Style

### Formatting

- **4-space indentation**, no tabs
- **Semicolons**: always
- **Single quotes** for all strings (double only inside template literals or JSON)
- **No trailing commas** in objects, arrays, imports, or function parameters
- **K&R brace style**: opening brace on same line
- No enforced max line length (lines often exceed 120 chars)

### Naming

| What              | Convention          | Example                          |
|-------------------|---------------------|----------------------------------|
| Variables/params  | `camelCase`         | `modelFamily`, `isClaudeModel`   |
| Functions         | `camelCase`         | `getFallbackModel()`             |
| Classes           | `PascalCase`        | `AccountManager`, `RateLimitError` |
| Module constants  | `UPPER_SNAKE_CASE`  | `MAX_RETRIES`, `DEFAULT_COOLDOWN_MS` |
| Files             | `kebab-case.js`     | `retry-utils.js`, `base-provider.js` |
| Private fields    | Native `#` prefix   | `#accounts`, `#configPath`       |
| Booleans          | `is`/`has`/`needs`  | `isInvalid`, `hasToolCalls`      |

### Imports

All imports are ESM. Always include the `.js` extension on local imports.

```javascript
import express from 'express';
import { logger } from '../utils/logger.js';
import { MAX_RETRIES, DEFAULT_COOLDOWN_MS } from '../constants.js';
```

- Named imports preferred: `import { foo } from '...'`
- Default imports only for packages (`express`) and provider classes
- No blank-line separators between import groups
- Multi-item imports broken across lines when long

### Exports

Named exports plus a default object re-exporting everything (dual pattern):

```javascript
export function isRateLimitError(error) { ... }
export class AuthError extends CommonsProxyError { ... }

export default { isRateLimitError, AuthError };
```

Classes use both: `export class Foo { ... }` and `export default Foo;`

### Functions

- Named `function` declarations for top-level/exported functions
- Arrow functions for callbacks, `.map()`, `.filter()`, short inline logic
- `async/await` everywhere; never `.then()` chains
- No `var`; use `const` by default, `let` when reassignment is needed

### Error Handling

Custom error hierarchy in `src/errors.js` — all extend `CommonsProxyError`:
`RateLimitError`, `AuthError`, `NoAccountsError`, `MaxRetriesError`, `ApiError`,
`EmptyResponseError`, `CapacityExhaustedError`, `NativeModuleError`

Type checking uses dual mode:
```javascript
if (error instanceof RateLimitError) return true;
// Plus string fallback for cross-boundary errors:
if (msg.includes('429') || msg.includes('resource_exhausted')) return true;
```

Server routes return Anthropic-format error JSON:
```javascript
res.status(statusCode).json({
    type: 'error',
    error: { type: errorType, message: errorMessage }
});
```

### Logging

```javascript
import { logger } from '../utils/logger.js';
logger.info('[Server] Account pool initialized');
logger.error('[CloudCode] Request failed:', error.message);
logger.debug('[RequestConverter] Applying thinking recovery');
```

Always use `[Tag]` prefix: `[Server]`, `[API]`, `[CloudCode]`, `[AccountManager]`,
`[WebUI]`, `[Config]`, `[Provider:Name]`, `[RequestConverter]`.

Guard expensive debug calls: `if (logger.isDebugEnabled) { ... }`

### Documentation

- Every source file starts with a `/** Module description */` block
- All exported functions have JSDoc with `@param` types and `@returns`
- Use `@typedef` for complex return shapes
- Section dividers within files: `// --- Section Name ---...` (em-dash ASCII art)
- Reference issues inline: `// [CRITICAL FIX] Issue #189`

## Test Conventions

Tests are **CommonJS `.cjs` files** (project is ESM; tests use `await import()` for ESM modules).
No test framework — custom lightweight infrastructure in each file.

### Structure
```javascript
async function runTests() {
    const { SomeModule } = await import('../src/some-module.js');

    // Assertion helpers (defined locally in each test file)
    function assertEqual(actual, expected, msg) { ... }
    function assertTrue(value, msg) { ... }
    function assertThrows(fn, expected, msg) { ... }

    let passed = 0, failed = 0;
    function test(name, fn) { /* try/catch, log pass/fail, increment counters */ }

    console.log('\n--- SomeModule Tests ---');
    test('SomeModule: does the thing', () => {
        assertEqual(SomeModule.compute(1), 2);
    });

    console.log(`\nTests completed: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
}
runTests().catch(err => { console.error(err); process.exit(1); });
```

- Test names: `'ModuleName: descriptive behavior'`
- Group tests with `console.log('\n--- Section ---')`
- Use `test()` for sync, `testAsync()` for async tests
- Mock helpers defined inline (e.g., `mockResponse()`, `createMockAccounts()`)

## Frontend (public/)

- **Alpine.js** for reactivity, **Tailwind CSS** + **DaisyUI** for styling
- State: `Alpine.store('global', ...)` in `store.js`, `Alpine.store('data', ...)` in `data-store.js`
- Account operations go through `window.AccountActions.*` service layer, not direct `fetch()`
- Async UI ops use `window.ErrorHandler.withLoading()` pattern
- Constants centralized in `public/js/config/constants.js` (`window.AppConstants`)
- i18n: 5 languages in `public/js/translations/` — **all 5 files must be updated together**
  (en.js, zh.js, tr.js, pt.js, id.js)
- CSS source: `public/css/src/input.css` -> compiled to `public/css/style.css`
  (never edit `style.css` directly; run `npm run build:css` after changing `input.css`)

## Key Architectural Rules

1. All local imports must have explicit `.js` extension
2. Sensitive values (API keys, tokens) must never be logged as plaintext — use `sha256(key).slice(0,8)`
3. All password/key comparisons must use `safeCompare()` from `src/utils/helpers.js` (constant-time)
4. File writes to `accounts.json` must go through the atomic write path (temp + rename + mutex)
5. `POST /test` endpoint is gated behind `NODE_ENV !== 'production'`
6. CORS is restricted to localhost origins only
7. Abstract base classes guard against direct instantiation: `if (new.target === Base) throw ...`
