# files made public with a link that works without a Slack login

Nothing errored, and nothing is going to. Somewhere in the app's history a developer needed an image URL that Block Kit could actually fetch, called files.sharedPublicURL, and it worked. Every file that call has been made against since &mdash; customer exports, database dumps, screenshots with a token still on screen &mdash; is readable by anyone holding the link, with no Slack account, no workspace membership and no expiry. The flag is on each file, and files.list will hand you all of them.

**Full guide with diagrams:** https://www.allanninal.dev/slack/public-file-links-exposed/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/slack_public_files_audit.py
node node/slack-public-files-audit.mjs
```

## Test it

```bash
pytest python/test_slack_public_files_audit.py
node --test node/slack-public-files-audit.test.mjs
```
