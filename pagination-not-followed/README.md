# next_cursor is ignored so only the first page is ever seen

The channel inventory has exactly 100 entries. So does the user directory. Nobody questions either number until somebody reports that a channel which plainly exists is missing from the report &mdash; and by then the sync has been dropping four fifths of the workspace every night for a year, with ok: true on every single response.

**Full guide with diagrams:** https://www.allanninal.dev/slack/pagination-not-followed/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/slack_pagination_audit.py
node node/slack-pagination-audit.mjs
```

## Test it

```bash
pytest python/test_slack_pagination_audit.py
node --test node/slack-pagination-audit.test.mjs
```
