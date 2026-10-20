# Daily Management (DM) in the admin console

The console's **DM** page hosts the company's Daily Management Plan system — the Google
Apps Script app at `script.google.com/macros/s/…/exec` ("EMVEESS DMP System"). It is not a
rebuild: the DMP is a controlled document (11 modules, photo evidence, signature, PDF
output), and two copies of it would drift.

## What the console does

`lib/dm-embed.ts` renders a panel on the design's `#dmPage`:

- **Conduct DM ↗** — opens the DMP app in a new tab (always works).
- **Reload / Fullscreen** — act on the embedded frame.
- The DMP app is embedded in an iframe when `NEXT_PUBLIC_DMP_EMBED` is not `off`.

Sign-in happens **inside the DMP app**. No DMP username, password or session is stored in
this repository, sent to our API, or logged — the frame is a separate origin with its own
login. Do not add those credentials to Vercel env vars either; there is nothing to
configure.

## Enabling the embedded frame

Checked on 2026-10-21: the live `/exec` response carries **no** `X-Frame-Options` and no CSP
`frame-ancestors`, so the frame loads as it is. Apps Script otherwise defaults to
`SAMEORIGIN`, which shows a blank frame — if this deployment ever starts sending that header,
add to the DMP project's `doGet()`:

```js
function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')   // the project's own file name
    .evaluate()
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
```

Then **Deploy → Manage deployments → Edit → New version → Deploy**. Until that is done,
either use **Conduct DM ↗** or set:

```dotenv
NEXT_PUBLIC_DMP_EMBED=off
```

so the page shows the launcher instead of a frame that can only ever be blank.

`ALLOWALL` lets any site frame the DMP app. The DMP login is the only thing protecting it,
so keep that password strong and rotate it if it has ever been shared in chat or email.

## Configuration

```dotenv
NEXT_PUBLIC_DMP_URL=https://script.google.com/macros/s/<deployment-id>/exec
NEXT_PUBLIC_DMP_EMBED=on        # or "off" for launcher-only
```

`NEXT_PUBLIC_*` values are inlined at build time — change them in Vercel and redeploy.
Only `https://` URLs are accepted; anything else falls back to the built-in deployment URL,
because the value is written into an iframe `src`.

Note the share link form: `/macros/s/<id>/exec`. The `/macros/u/1/s/<id>/exec` variant is
tied to a specific Google account and returns "Page Not Found" for everyone else.
