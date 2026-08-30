# not_in_channel: the bot was never invited to the channel

The app is installed. The token authenticates. The channel ID was copied out of the URL and is correct. Every call still comes back {"ok": false, "error": "not_in_channel"}, because installing an app to a workspace does not put it in a single channel &mdash; and this is, by view count, the most-asked Slack API question there is.

**Full guide with diagrams:** https://www.allanninal.dev/slack/bot-not-in-channel/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/slack_channel_membership.py
node node/slack-channel-membership.mjs
```

## Test it

```bash
pytest python/test_slack_channel_membership.py
node --test node/slack-channel-membership.test.mjs
```
