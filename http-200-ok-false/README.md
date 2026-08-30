# slack answers HTTP 200 and puts the failure in the body

The deploy is green. The log line reads POST https://slack.com/api/chat.postMessage 200. Nothing has appeared in the channel for three weeks. When somebody finally logs the response body it reads {"ok": false, "error": "not_in_channel"} &mdash; and it has read that, unchanged, every single time.

**Full guide with diagrams:** https://www.allanninal.dev/slack/http-200-ok-false/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/slack_ok_false_audit.py
node node/slack-ok-false-audit.mjs
```

## Test it

```bash
pytest python/test_slack_ok_false_audit.py
node --test node/slack-ok-false-audit.test.mjs
```
