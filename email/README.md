# Daily report email

Builds the Pixtaha Management daily server report email from a payload v1 (see `docs/report/payload-v1.md`).

| File | Purpose |
|---|---|
| `builder.js` | Table-based, inline-styled HTML email (Gmail / Outlook / Apple Mail). From the Claude Design export, Pixtaha Design System. |
| `adapter.js` | Payload v1 -> email view model: subject, preheader, manager note, blocks shown only when the server has that workload. |
| `main.js` | n8n Code node entry: reads the Webhook body and outputs subject + html. |
| `n8n-code-node.js` | Minified `builder.js` + `adapter.js` + `main.js`, pasted into the "Build Report Email" Code node. |
| `render.js` | Local preview: `node email/render.js payload.json out.html [light|dark]` |

Rebuild the Code node script after editing:

    npx terser email/builder.js email/adapter.js -c -m --comments false -f inline_script=false -o /tmp/lib.min.js
    cat /tmp/lib.min.js email/main.js > email/n8n-code-node.js

n8n workflow "Server Manager": Webhook (Header Auth) -> Build Report Email -> Send via Resend.
