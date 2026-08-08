# Demo publish checklist

## Live URLs

- **Pangea app (password gated):** https://newsambellamy.github.io/pangea-notebook/
- **Landing page source:** https://github.com/NewSamBellamy/Hidden-Door-Landing-Page
- **App source:** https://github.com/NewSamBellamy/pangea-notebook
- **GitHub profile:** https://github.com/NewSamBellamy

## Enable GitHub Pages for the app (required once)

In `NewSamBellamy/pangea-notebook`:

1. **Settings → Pages**
2. Source: **Deploy from a branch**
3. Branch: **`gh-pages`**
4. Folder: **`/ (root)`**
5. Save

Wait 1–3 minutes, then open:
`https://newsambellamy.github.io/pangea-notebook/`

### Demo unlock password

```
PangeaDemo2026
```

Change it in `src/components/AppGate.tsx` before broader sharing.

## Keep source private while Pages stays public (important)

On **GitHub Free personal accounts**:

- GitHub Pages for a **public site** generally needs a **public repository**.
- If you set `pangea-notebook` to **private**, the Pages site can stop being publicly servable on Free.

### Recommended setup for tomorrow

1. Keep a **public deploy branch/repo surface** for the built site (`gh-pages` content), password-gated in-app.
2. Keep unfinished source less exposed by:
   - not advertising the repo
   - scrubbing README/HANDOFF of internal notes
   - using the app password gate
3. If you need true private source + public Pages long-term, use one of:
   - a separate public **deploy-only** repo that contains only `index.html` (no source)
   - GitHub Pro / org plan features

For tomorrow, the practical path is:

- Pages site public + **app password**
- Source repo can remain public but unlinked/unadvertised, or move source private after creating a deploy-only public repo

## Landing page note

`Hidden-Door-Landing-Page` currently includes a client-side gate password in page JavaScript (`TetCorp`).  
That is visible to anyone who views page source. Rotate it if that landing page is shared widely.

## Supabase

App cloud backend: project **Pangea** (`rlqfxfthzgukejcfnhug`).

Before demo:
- Auth email confirmations configured the way you want
- Test account signed in once
- Click **Save now**
- Refresh and confirm books + API key restore
