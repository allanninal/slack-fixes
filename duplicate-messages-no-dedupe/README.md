# the same message posted three times, and the ts says why

The alert channel has the same incident in it four times. Every one of those messages is a real, successful chat.postMessage call that returned ok: true and a distinct ts, so nothing failed and nothing will appear in your error tracker. The duplicates are not a display bug &mdash; they are four separate decisions your system made to send, and the record of all four is sitting in conversations.history waiting to be read.

**Full guide with diagrams:** https://www.allanninal.dev/slack/duplicate-messages-no-dedupe/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/slack_duplicate_messages.py
node node/slack-duplicate-messages.mjs
```

## Test it

```bash
pytest python/test_slack_duplicate_messages.py
node --test node/slack-duplicate-messages.test.mjs
```
