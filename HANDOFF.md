# Handoff notes — read this first

You're picking up **Pangea** (formerly "YOK Notebook") mid-project. This file is
the fast-orientation doc: what it is, how it's built, what's been tried and
reverted, and what's realistically next. Every source file also has a header
docblock explaining its role — start with `src/types.ts` for the data model,
then `src/ai.ts` for how AI calls are routed.

## What this is

A local-first web app for creators (filmmakers first, but general-purpose).
Every project is a **book**: you plan it in one conversation, an AI agent
binds it into a table of contents with a generated cover, then you draft,
mark up, and rewrite it page by page. Everything — chat history, notes,
research, generated assets, a changelog — lives inside that one book. No
backend, no accounts: books persist in the browser (IndexedDB), the user
brings their own Gemini API key (stored in `localStorage`, never leaves the
device), and the whole app builds to **one self-contained HTML file**.

The product pitch (for context on *why* things are shaped the way they are):
a notebook/journal metaphor where "starting a new project" = "beginning a
new book," reading = auditing/refining with voice + ink annotations, and the
book is the single source of truth instead of scattered chats and docs.

## Quick start

```bash
npm install
npm run dev        # Vite dev server
npm run build       # → dist/index.html, a single self-contained file
npm run test:e2e    # Playwright suite against dist/index.html, offline/demo mode
GEMINI_KEY=... node e2e-live.mjs   # same, but exercises the REAL Gemini API
```

Opening `dist/index.html` directly (or via a static host / artifact preview)
is the whole deployment story. There is no server.

## Architecture in one paragraph

React + TypeScript, bundled by Vite with `vite-plugin-singlefile` into one
HTML file (CSS and JS inlined, images inlined as base64 via the asset
pipeline). No router — `store.tsx`'s `View` enum + `App.tsx`'s switch is the
entire navigation. All AI calls go through `src/ai.ts` (the facade), which
routes to either `src/gemini.ts` (plain `fetch` to the Gemini REST API — no
SDK) or `src/demo.ts` (a fully offline "demo brain" with procedural SVG art
and scripted responses) depending on whether `settings.apiKey` is set. Every
component reads/writes book state through `store.tsx`'s `mutateBook`, which
deep-clones, applies your updater, and persists via `storage.ts` (Dexie/
IndexedDB with an in-memory fallback for sandboxed contexts).

## File map

```
index.html                  Vite entry — Google Fonts, favicon (inline SVG)
src/main.tsx                ReactDOM root
src/App.tsx                 View switch (library / newBook / book) + Settings modal + toast
src/store.tsx               Global state: books, settings, view routing, token attribution
src/types.ts                THE DATA MODEL — read this first
src/storage.ts              IndexedDB (Dexie) persistence + localStorage settings
src/ai.ts                   AI FACADE — every component calls this, never gemini.ts/demo.ts directly
src/gemini.ts               Real Gemini REST client (fetch-based, no SDK)
src/demo.ts                 Offline demo brain: procedural SVG art + scripted responses
src/actions.ts              Applies AgentAction (model → book mutations) + changelog (addLog)
src/styles.css              ONE global stylesheet, ~1800 lines, organized by section comments

src/components/
  Library.tsx                The Study (home screen): shelf + desk + focus view launcher
  FocusPanel.tsx             Book metadata/actions/cover-studio panel (used by focus view)
  Book3D.tsx                 The physical book, HTML/CSS 3D (title plate, spine, cover art)
  NewBook.tsx                Plan → interview → outline → cover → bound book
  BookView.tsx               Open-book spread: page nav, page-flip animation, read/audit session
  PageCanvas.tsx             Page rendering + annotation radial tool ring + cover/TOC
  ChatPanel.tsx              THE BIG ONE — Scribe/Research/Create/Notes/Logs/Assets tabs
  ImageStudio.tsx            "Draw on it, regenerate" modal for page images
  SettingsModal.tsx          API key + model + import book

landing/index.html           Standalone marketing/email-capture page (not part of the app build)
e2e.mjs / e2e-live.mjs        Playwright suites (offline demo mode / real Gemini API)
README.md                     User-facing docs
```

## The AI protocol (important if you touch prompts)

Chat-style AI turns (Scribe, book-level restructuring, page audits) can end
their reply with a fenced ` ```json {"actions": [...]} ``` ` block. See
`AgentAction` in `types.ts` and `ACTION_SPEC` in `gemini.ts` for the exact
shape, and `applyActions` in `actions.ts` for how those get applied
(including re-running image generation for any block that lost its `id`,
which is how "regenerate this image" requests work inside a normal chat
reply). Every UI action that mutates a book should also call `addLog(...)`
so the Logs tab stays meaningful.

## Known constraints / non-obvious decisions

- **Single HTML file build.** Don't add anything that needs its own
  server-side route, cookie, or backend — that's a different product.
- **`gemini-2.5-*` models are retired for new API keys.** Defaults are
  `gemini-flash-latest` / `gemini-3.1-flash-image`, with a migration shim in
  `storage.ts` (`MODEL_MIGRATIONS`) for anyone with old saved settings.
  Double-check current model availability before hardcoding new IDs —
  `TEXT_MODELS`/`IMAGE_MODELS` in `types.ts` is the canonical list the UI
  offers; keep it in sync with what the key actually has access to
  (`testKey` in `gemini.ts` validates this).
- **Demo mode is a first-class feature, not an afterthought.** The app must
  always work with zero network/API key — this is how it survives being
  shown to someone who hasn't pasted a key yet, or a flaky venue wifi.
  Every `ai.ts` function has a demo-mode branch; keep that contract when
  adding features.
- **Page-flip animation was hard-won.** See the `flip` state in
  `BookView.tsx` and the CSS in `styles.css` (search "page turn"). The
  turning leaf carries the REAL destination page's content on its back
  face (`StaticPageFace`) so the turn looks physically real, hinged exactly
  at the measured left-leaf edge. `backface-visibility` was unreliable
  across engines — face visibility is driven by explicit opacity keyframes
  timed to the 90° crossing instead. Don't "simplify" this without testing
  in a real browser, not just headless.
- **A Three.js 3D bookshelf was built and explicitly reverted** (the user
  didn't like the look/feel after two iterations). It's fully gone from
  `main` — no `three` dependency, no `Library3D.tsx`. If revisiting this,
  treat it as a fresh experiment, not a resurrection; check git history /
  prior thread notes for what was tried (procedural clothbound-hardcover
  geometry, canvas-textured cloth/spine-foil/cover-art, shelf-alcove
  environment, spring-damped pull animation) so you don't repeat dead ends.
- **The study backdrop (`src/assets/study.jpg`) is an AI-generated image**,
  not a photo. If you need a variant (different time of day, etc.), the
  original generation prompt is preserved in thread history — regenerate
  rather than hand-editing the JPEG.
- **Testing requires real browser verification, not just headless
  screenshots at one viewport.** Several regressions (page-flip geometry,
  responsive layout collapsing under ~900px, panel clipping) were only
  caught by testing at the actual size the user was viewing in (often a
  ~880px artifact-preview iframe, not a full browser tab). When in doubt,
  test at 880px width AND 1440px+ before calling something done.
- **The GitHub repo image asset:** `src/assets/study.jpg` is a binary file.
  Verify after any GitHub push that it made it through as an intact
  binary (not corrupted by a text-mode API call) — see the repo's
  `study.jpg` file size/preview on GitHub, or fetch it and check the file
  signature, before assuming it's fine.

## What's been audited and fixed (chronological, so you don't redo work)

1. Core build: study scene, book generation flow (plan → interview →
   outline → cover → pages), Scribe chat with canvas edits, red-pen/
   highlighter annotation tools, read-session → page audit, image
   regeneration via markup, brain dump, live Gemini verification.
2. Study rebuilt around a real AI-generated backdrop image (previous
   version used flat CSS panels that looked fake); model defaults fixed
   for retired `gemini-2.5-*` IDs; book covers made AI-generated with a
   typographic overlay template; focus-view "pull to desk" interaction;
   token tracking per book.
3. Full UX audit pass: tab rename/restructure (Scribe/Research/Notes/Logs/
   Assets), audit-to-Scribe compiled draft flow, TOC inline editing,
   persistent radial tool ring, book-level TOC restructuring via chat,
   new-book "thinking carousel" while binding.
4. Page-flip animation rebuilt from scratch (see constraints above) after
   research into how libraries like turn.js/StPageFlip do it.
5. A Three.js 3D library experiment (built, iterated, reverted per user
   judgment call — see constraint above).
6. Full rebrand to **Pangea** ("where every world begins") — atlas-globe
   logo/favicon, updated landing page and README.
7. Create tab rebuilt to Google-AI-Studio parity: real model pickers,
   temperature/output-length/thinking-level/system-instructions run
   settings persisted per book, image lightbox viewer, writing reader
   (fixed a bug where it only rendered inside one tab). Shelves filled
   with warm procedural "filler" spines so the library never looks empty.

## Suggested next steps (not started, or explicitly deferred)

- Push to a public GitHub repo + GitHub Pages hosting (this is what this
  handoff push is *for* — check the repo's Actions/Pages setup on arrival).
- Landing page: real email capture backend (currently `localStorage`-only
  with a documented `FORM_ENDPOINT` hook for Formspree/Basin).
- Possible Electron desktop wrapper (architecture was kept portable for
  this from day one — storage is behind `storage.ts`, no server deps).
- Drag-to-flip pages with the mouse (StPageFlip-style), if revisited.
- Whisper-quality voice transcription upgrade (currently Web Speech API,
  which is good-enough-not-great and browser-dependent).

## Rotate the demo API key

A Gemini API key was pasted into chat during development/testing for this
project. If it's still active, **rotate it** at aistudio.google.com before
shipping this publicly — never hardcode it anywhere in the repo (it never
was, but flag this for whoever owns the account).
