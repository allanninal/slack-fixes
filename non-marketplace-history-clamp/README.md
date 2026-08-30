# conversations.history clamped to 15 objects and 1 per minute

A backfill that used to take an hour now takes weeks, and nothing in your code changed. conversations.history still returns ok: true, still returns a valid page, still gives you a cursor &mdash; it just returns 15 messages when you asked for 200, and refuses the second call inside the same minute. This is Slack's May 2025 rate-limit change for apps that are not approved for the Marketplace, and it is working exactly as designed.

**Full guide with diagrams:** https://www.allanninal.dev/slack/non-marketplace-history-clamp/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/slack_history_clamp_probe.py
node node/slack-history-clamp-probe.mjs
```

## Test it

```bash
pytest python/test_slack_history_clamp_probe.py
node --test node/slack-history-clamp-probe.test.mjs
```
