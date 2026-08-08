# Demo publish checklist

## Live URLs

- **Landing page (public QR target):** https://newsambellamy.github.io/Hidden-Door-Landing-Page/
- **Pangea app (invite-only demo):** https://newsambellamy.github.io/pangea-notebook/

Do **not** put the app demo password in this repository or any public doc.

## GitHub Pages (app)

In `pangea-notebook`:

1. **Settings → Pages**
2. Source: **Deploy from a branch**
3. Branch: **`gh-pages`**
4. Folder: **`/ (root)`**
5. Save

Wait 1–3 minutes, then open the app URL above.

## Demo unlock password

Stored **only** with the demo host (not in git).

Set / rotate it in `src/components/AppGate.tsx`, then:

```bash
npm install
npm run build
# deploy dist/ to gh-pages branch
```

## Keep source private while Pages stays public

On **GitHub Free** personal accounts, making a repo private can **unpublish** public Pages.

Safer options:

1. **Tomorrow (safest):** keep deploy surfaces stable; do not flip visibility mid-event; QR only the landing page.
2. **Long-term:** GitHub Pro (private source + public Pages), **or** a public deploy-only repo that contains built static files only.

## Landing page note

The Hidden Door landing gate is a client-side booth password. It unlocks marketing content only — not the Pangea app, not Supabase user data.

## Supabase

Configure auth and test sign-in before the event. Do not commit API secrets to git.
