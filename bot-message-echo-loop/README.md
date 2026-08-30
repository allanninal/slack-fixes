# the bot answers its own messages in an endless loop

A channel fills with hundreds of identical bot messages in a few seconds. Slack starts rate-limiting the app, which slows the flood without stopping it, and in the end somebody removes the bot from the channel to make it stop. The cause is one line that was never written: the handler subscribed to message.channels, which delivers every message in the channel, including the one the app posted a moment ago.

**Full guide with diagrams:** https://www.allanninal.dev/slack/bot-message-echo-loop/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/slack_echo_loop_audit.py
node node/slack-echo-loop-audit.mjs
```

## Test it

```bash
pytest python/test_slack_echo_loop_audit.py
node --test node/slack-echo-loop-audit.test.mjs
```
