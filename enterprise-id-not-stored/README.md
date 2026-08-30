# installs keyed on team_id alone collide on Enterprise Grid

Two customers file the same ticket in the same week: messages from their Slack app are arriving in a channel that belongs to somebody else. Both are on the same Enterprise Grid organisation. Your installation store has one row per team_id, it has always had one row per team_id, and on a single-workspace customer that was correct. On Grid it is a cross-tenant data leak with a green dashboard.

**Full guide with diagrams:** https://www.allanninal.dev/slack/enterprise-id-not-stored/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/slack_install_key_audit.py
node node/slack-install-key-audit.mjs
```

## Test it

```bash
pytest python/test_slack_install_key_audit.py
node --test node/slack-install-key-audit.test.mjs
```
