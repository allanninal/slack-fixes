# every Slack profile has a null email and nothing errored

The nightly user sync has been green for four months. It reads every member out of Slack, writes them to the warehouse, and joins them against the HR system on email. The join has matched nothing since the day it shipped, because every row it wrote has email = null &mdash; and users.list returned ok: true, with complete-looking profiles, every single night.

**Full guide with diagrams:** https://www.allanninal.dev/slack/users-read-email-missing/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/slack_email_scope_audit.py
node node/slack-email-scope-audit.mjs
```

## Test it

```bash
pytest python/test_slack_email_scope_audit.py
node --test node/slack-email-scope-audit.test.mjs
```
