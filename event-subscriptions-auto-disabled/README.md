# Slack disabled event delivery and will not turn it back on

There was a two-hour outage on Tuesday. The service came back, the health checks went green, the on-call went to bed. On Thursday somebody asks why the bot has not answered anyone since Tuesday. Slack turned event delivery off during the outage, emailed the app owner about it, and does not turn it back on when you recover &mdash; a human has to click a button that nobody knows exists.

**Full guide with diagrams:** https://www.allanninal.dev/slack/event-subscriptions-auto-disabled/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/slack_event_silence_audit.py
node node/slack-event-silence-audit.mjs
```

## Test it

```bash
pytest python/test_slack_event_silence_audit.py
node --test node/slack-event-silence-audit.test.mjs
```
