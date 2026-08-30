# files.upload is retired: one probe returns method_deprecated

Every internal tool that posts a screenshot into Slack stopped posting screenshots, all of them on the same day, none of them deployed that week. The logs say 200. The bodies say {"ok": false, "error": "method_deprecated"}. Nothing broke: files.upload reached the end of a sunset that was announced eighteen months earlier and moved once.

**Full guide with diagrams:** https://www.allanninal.dev/slack/files-upload-retired/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/slack_files_upload_probe.py
node node/slack-files-upload-probe.mjs
```

## Test it

```bash
pytest python/test_slack_files_upload_probe.py
node --test node/slack-files-upload-probe.test.mjs
```
