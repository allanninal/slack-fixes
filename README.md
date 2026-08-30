# Slack Fixes

Read-only Python and Node.js scripts that find Slack app problems through the API — ok:false behind an HTTP 200, missing scopes, a bot outside the channel it posts to, and pagination nobody followed. They report and print the repair; they never write.

Every script here is read only. They hold a credential to a live account, so none of them writes: each one reads through the API, reports exactly what is wrong, and prints the repair for you to run.

By **[Allan Niñal](https://github.com/allanninal)** — AI Solutions Engineer. I build AI powered tools, data products, and AWS automation.
Full write ups with diagrams for each fix live at **[allanninal.dev/slack](https://www.allanninal.dev/slack/)**.

[![Follow on GitHub](https://img.shields.io/github/followers/allanninal?label=Follow%20%40allanninal&style=social)](https://github.com/allanninal)
## The fixes

- [the bot answers its own messages in an endless loop](./bot-message-echo-loop/) — https://www.allanninal.dev/slack/bot-message-echo-loop/
- [not_in_channel: the bot was never invited to the channel](./bot-not-in-channel/) — https://www.allanninal.dev/slack/bot-not-in-channel/
- [the same message posted three times, and the ts says why](./duplicate-messages-no-dedupe/) — https://www.allanninal.dev/slack/duplicate-messages-no-dedupe/
- [slack answers HTTP 200 and puts the failure in the body](./http-200-ok-false/) — https://www.allanninal.dev/slack/http-200-ok-false/
- [missing_scope tells you the scope needed and the ones you have](./missing-scope-on-read/) — https://www.allanninal.dev/slack/missing-scope-on-read/
- [conversations.history clamped to 15 objects and 1 per minute](./non-marketplace-history-clamp/) — https://www.allanninal.dev/slack/non-marketplace-history-clamp/
- [next_cursor is ignored so only the first page is ever seen](./pagination-not-followed/) — https://www.allanninal.dev/slack/pagination-not-followed/
- [files made public with a link that works without a Slack login](./public-file-links-exposed/) — https://www.allanninal.dev/slack/public-file-links-exposed/

## How to run one

Each folder holds the same script in Python and in Node.js, plus its test. Set the environment variables named in that folder's README and run it. Nothing writes, so there is no dry run to enable and no flag to be careful about — use a restricted, read-only credential and the worst case is that it tells you nothing is wrong.

## License

MIT. Use it, change it, ship it.
