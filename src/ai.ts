/**
 * AI facade — every component calls into THIS file, never src/gemini.ts or
 * src/demo.ts directly. Each exported function here checks
 * `isLive(settings)` (i.e. is a Gemini API key configured) and routes to
 * the real API (src/gemini.ts) or the offline demo brain (src/demo.ts)
 * accordingly, with graceful fallback to procedural art on any image
 * generation failure. This is the seam to extend if another provider is
 * ever added — swap the routing here, nothing else needs to change.
 */

// AI facade — routes to the real Gemini API when a key is configured,
// otherwise to the offline demo brain so the app always feels alive.

import type {
  Annotation, Block, Book, BrainDumpAssignment, ChatResult, Msg, OutlineResult, Page, Settings, TranscriptSeg,
} from './types';
import * as gem from './gemini';
import * as demo from './demo';

const live = (s: Settings) => !!s.apiKey.trim();

export const isLive = live;

/** Surface a background AI failure to the UI (store listens and toasts). */
function reportErr(context: string, e: unknown) {
  try {
    window.dispatchEvent(new CustomEvent('yok-ai-error', { detail: `${context}: ${(e as Error).message ?? e}` }));
  } catch { /* non-browser */ }
}

export async function outline(s: Settings, plan: { prompt: string; vibe?: string; interview?: { q: string; a: string }[] }): Promise<OutlineResult> {
  return live(s) ? gem.generateOutline(s, plan) : demo.demoOutline(plan.prompt);
}

export async function draft(s: Settings, book: Book, page: Page): Promise<Block[]> {
  if (!live(s)) return demo.demoDraftPage(page, book.palette);
  const blocks = await gem.draftPage(s, book, page);
  // Generate images for image blocks (best-effort, placeholders on failure)
  for (const b of blocks) {
    if (b.type === 'image' && b.imagePrompt && !b.imageData) {
      try {
        b.imageData = await gem.generateImage(s, b.imagePrompt, book.title);
      } catch (e) {
        reportErr('Image generation failed — using placeholder art', e);
        b.imageData = demo.placeholderImage(b.imagePrompt, b.caption ?? page.title, book.palette);
      }
    }
  }
  return blocks;
}

export async function chat(s: Settings, book: Book, page: Page | null, history: Msg[], text: string): Promise<ChatResult> {
  return live(s) ? gem.chatTurn(s, book, page, history, text) : demo.demoChat(text, page);
}

export async function fillImages(s: Settings, book: Book, blocks: Block[], pageTitle: string): Promise<Block[]> {
  for (const b of blocks) {
    if (b.type === 'image' && !b.imageData) {
      if (live(s) && b.imagePrompt) {
        try {
          b.imageData = await gem.generateImage(s, b.imagePrompt, book.title);
          continue;
        } catch (e) {
          reportErr('Image generation failed — using placeholder art', e);
        }
      }
      b.imageData = demo.placeholderImage(b.imagePrompt ?? pageTitle, b.caption ?? pageTitle, book.palette);
    }
  }
  return blocks;
}

export async function regenerateImage(s: Settings, book: Book, markedDataUrl: string, instruction: string, fallbackPrompt: string): Promise<string> {
  if (live(s)) return gem.editImage(s, markedDataUrl, instruction);
  await new Promise((r) => setTimeout(r, 1200));
  return demo.placeholderImage(fallbackPrompt + ' ' + instruction, instruction.slice(0, 60) || 'Revised plate', (book.palette + 1) % 4);
}

export async function dump(s: Settings, book: Book, text: string): Promise<BrainDumpAssignment[]> {
  return live(s) ? gem.brainDump(s, book, text) : demo.demoBrainDump(book, text);
}

export async function audit(
  s: Settings, book: Book, page: Page,
  annotations: Annotation[], transcript: TranscriptSeg[], snapshot: string | null,
  extraNote?: string,
): Promise<ChatResult> {
  return live(s)
    ? gem.auditReadSession(s, book, page, annotations, transcript, snapshot, extraNote)
    : demo.demoAudit(page, annotations, transcript, extraNote);
}

export async function research(
  s: Settings, book: Book, page: Page | null, history: import('./types').Msg[],
  text: string, opts: { deep?: boolean; auditNote?: string; attachments?: { mimeType: string; data: string }[]; model?: string } = {},
): Promise<import('./types').ResearchResult> {
  return live(s) ? gem.research(s, book, page, history, text, opts) : demo.demoResearch(text, !!opts.deep);
}

/** Create-tab image generation (falls back to procedural plates in demo mode). */
export async function createImage(s: Settings, prompt: string, run: gem.StudioRun): Promise<string> {
  if (live(s)) {
    return gem.createImage(s, prompt, run);
  }
  await new Promise((r) => setTimeout(r, 900));
  return demo.placeholderImage(prompt, prompt.slice(0, 56), Math.floor(Math.random() * 4));
}

/** Create-tab text generation. */
export async function createText(s: Settings, prompt: string, run: gem.StudioRun): Promise<string> {
  if (live(s)) return gem.createText(s, prompt, run);
  await new Promise((r) => setTimeout(r, 700));
  return `(demo) With a Gemini key, this becomes a real ${run.model} generation of: "${prompt.slice(0, 120)}" — written with your book's full context. Add a key in Settings.`;
}

export async function interview(s: Settings, prompt: string): Promise<string[]> {
  return live(s) ? gem.interviewQuestions(s, prompt) : demo.demoInterview(prompt);
}

/** Generate (or re-spin) a book's cover artwork from an art direction. */
export async function cover(s: Settings, artDirection: string, paletteIdx: number): Promise<string> {
  if (live(s)) {
    try {
      return await gem.generateCoverArt(s, artDirection);
    } catch (e) {
      reportErr('Cover generation failed — using placeholder art', e);
    }
  } else {
    await new Promise((r) => setTimeout(r, 900));
  }
  return demo.makeCoverArt(artDirection, paletteIdx, Date.now() % 9973);
}

export { testKey } from './gemini';
