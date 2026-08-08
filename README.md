# Pangea 🌍

**Your whole project, bound like a book.**

Pangea is a local-first web app for filmmakers and every kind of creator. Instead of scattering a project across chats, docs, and notes apps, each project becomes a *book*: planned in one conversation, bound into a table of contents by an AI agent, then drafted, marked up, and rewritten page by page — with all your research and context living right where the work is.

## The experience

- **A real bookshelf.** Every project is a book with a titled spine, your palette, your typeface. Open one into a two-page spread: the formatted **canvas** on the left, your **editor-in-residence** on the right.
- **Plan first, then bind.** Every book starts with a plan — one quick prompt, or *interview mode* where the agent asks its five sharpest questions. It then designs a 12–20 page table of contents tailored to your project, from vision down to production detail.
- **Page-scoped conversation.** Chat lives on each page. Brainstorm freely, then say *"add it to the canvas"* — the agent writes straight onto the page. Talk to the cover to make book-wide moves.
- **Read sessions.** Grab the red pen, highlighter, or circle tool (right-click for the tool ring). Start a read session and think out loud while you mark the page — your voice is transcribed and time-synced to every stroke of ink. End the session and the agent audits the page and revises it to your notes.
- **Draw on the images.** Click any image, circle what's wrong ("his ears need to be bigger"), and it regenerates in place.
- **Notes that wait for you.** Pin sticky notes to pages. Open notes surface on the cover as your task list.
- **Brain dump.** Paste months of scattered notes — the agent files each thought onto the right page.

## Privacy & keys

- **Local-first**: all books live in your browser's IndexedDB. Nothing is uploaded anywhere.
- **Bring your own key**: plug a [Gemini API key](https://aistudio.google.com/apikey) into Settings (stored only on your device, sent only to Google's API from your browser).
- **Demo mode**: no key? The app runs fully offline with a scripted agent and procedural engraved-plate artwork, seeded with a sample book — *The Argo Protocol*.

## Run it

```bash
npm install
npm run dev       # local dev server
npm run build     # production build → dist/index.html (a single self-contained file)
npm run test:e2e  # headless end-to-end suite (Playwright)
```

The production build is **one HTML file** — host it anywhere (GitHub Pages, Netlify, a USB stick) or open it directly in a browser.

## Landing page

`landing/index.html` is a standalone landing page with email-interest capture. Set `FORM_ENDPOINT` inside it to a [Formspree](https://formspree.io) endpoint to collect emails for real; until then signups are stored in `localStorage` (`yok-signups`) — handy for kiosk/demo collection.

## Architecture

- React + TypeScript + Vite, bundled to a single file via `vite-plugin-singlefile`
- Dexie (IndexedDB) with graceful in-memory fallback
- Gemini API called directly from the browser (`gemini-2.5-flash` for writing, `gemini-2.5-flash-image` for images)
- Web Speech API for read-session transcription (degrades gracefully where unavailable)
- No server, no accounts, no telemetry — Electron-portable by construction

## Roadmap

- Whisper-quality voice pipeline for read sessions
- Page-flip physics & pen pressure
- Linked notes app / cross-book references
- Electron desktop build

---

Free, open source, made for creators. ⚓
