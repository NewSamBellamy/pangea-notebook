# Pangea

**Where every world begins.**

Pangea is a project notebook for creators. Each project becomes a book: planned with an AI partner, bound into a table of contents, then drafted, researched, annotated, and revised page by page.

## Live demo

Private walkthrough build (password gated):

**https://newsambellamy.github.io/pangea-notebook/**

Ask the demo host for the unlock password.

After unlock:
1. Open **Settings**
2. Sign in / create your Pangea account (Supabase)
3. Add your Gemini API key
4. Click **Save now**

Your books and settings sync to the dedicated Supabase project for this app.

## Status

This repository contains the application source. The product is under active private demo preparation and is **not** an open contribution target yet.

## Local development

```bash
npm install
npm run dev
npm run build
npm run test:e2e
```

Production build emits a single self-contained `dist/index.html`.

## Privacy notes

- Gemini API keys are stored in the browser and optionally synced to the signed-in user’s Supabase settings row.
- Book data syncs to Supabase when signed in; local IndexedDB remains a backup on the device.
- The demo unlock gate is a shared password for walkthrough access only (not a substitute for user accounts).

## License

Private / all rights reserved until publicly opened.
