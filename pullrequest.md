# Title;
```text

```

## Description;
```markdown
fixed the rate limit stuff so it actually reads the proper delay from google now instead of guessing.. fixed the loop where it stuck to a rate-limited account forever (sticky failover).. updated the /health endpoint to show like literally everything (all models, quotas, cooldowns etc).. also refactored logging.. added colors & a --debug flag so its cleaner.. silenced batch log spam unless ur in debug mode..
```