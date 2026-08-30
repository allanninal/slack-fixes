# missing_scope tells you the scope needed and the ones you have

{"ok": false, "error": "missing_scope", "needed": "channels:history", "provided": "chat:write,commands,users:read"}. The developer swears the scope is in the app configuration, and it is &mdash; but the app was never reinstalled, so the token in production still carries the grant it was issued with.

**Full guide with diagrams:** https://www.allanninal.dev/slack/missing-scope-on-read/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/slack_scope_audit.py
node node/slack-scope-audit.mjs
```

## Test it

```bash
pytest python/test_slack_scope_audit.py
node --test node/slack-scope-audit.test.mjs
```
