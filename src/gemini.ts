/**
 * Direct Gemini API client (no SDK — plain fetch to
 * generativelanguage.googleapis.com). This is the ONLY file that knows the
 * Gemini REST shape; src/ai.ts is the facade everything else calls.
 *
 * Key responsibilities:
 * - `call()` — the shared low-level request builder (generationConfig,
 *   systemInstruction, google_search tool, image response modalities,
 *   thinkingConfig). Also fires a `yok-tokens` window event with
 *   usageMetadata.totalTokenCount so the store can attribute spend to the
 *   active book (see src/store.tsx).
 * - `generateOutline` — turns a creator's plan (+ optional interview
 *   answers) into a table of contents (OutlineResult), including cover art
 *   direction.
 * - `draftPage` — writes one page's full content as JSON blocks.
 * - `chatTurn` — the Scribe: page- or book-scoped chat that can emit
 *   AgentAction blocks to mutate the book (see ACTION_SPEC below).
 * - `research` — the Research desk: Google Search–grounded chat, optional
 *   attachments (inlineData), optional "deep research" report mode.
 * - `createImage` / `createText` — the Create tab (AI Studio-style):
 *   standalone generations with explicit model/temperature/thinking/system
 *   instruction control (StudioRun), not tied to a specific page.
 * - `auditReadSession` — turns a page's annotations + voice transcript (+
 *   optional snapshot image + the creator's follow-up note) into a page
 *   revision.
 * - `generateCoverArt` / `editImage` — book cover generation/re-spin and
 *   marked-up image regeneration (Image Studio).
 * - `testKey` — validates a pasted API key against the live models list.
 *
 * Model names are passed in via Settings/StudioPrefs (see src/types.ts) —
 * this file has no hardcoded model IDs beyond the deep-research override
 * (gemini-pro-latest).
 */

import type {
  AgentAction, Block, Book, BrainDumpAssignment, ChatResult, Msg,
  OutlineResult, Page, Settings, TranscriptSeg, Annotation, ResearchResult,
} from './types';
import { uid } from './types';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

interface Part {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

async function call(
  settings: Settings,
  model: string,
  parts: Part[],
  opts: {
    json?: boolean; imageOut?: boolean; aspect?: string; search?: boolean;
    history?: { role: string; parts: Part[] }[];
    temperature?: number; maxOutputTokens?: number;
    thinking?: 'auto' | 'low' | 'high';
    system?: string;
  } = {},
): Promise<{ text: string; imageData?: string; sources?: { title: string; uri: string }[] }> {
  const body: Record<string, unknown> = {
    contents: [...(opts.history ?? []), { role: 'user', parts }],
  };
  const genCfg: Record<string, unknown> = {};
  if (opts.json) genCfg.responseMimeType = 'application/json';
  if (opts.imageOut) genCfg.responseModalities = ['IMAGE', 'TEXT'];
  if (opts.imageOut && opts.aspect) genCfg.imageConfig = { aspectRatio: opts.aspect };
  if (opts.temperature !== undefined) genCfg.temperature = opts.temperature;
  if (opts.maxOutputTokens) genCfg.maxOutputTokens = opts.maxOutputTokens;
  if (opts.thinking && opts.thinking !== 'auto') genCfg.thinkingConfig = { thinkingLevel: opts.thinking };
  if (Object.keys(genCfg).length) body.generationConfig = genCfg;
  if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };
  if (opts.search) body.tools = [{ google_search: {} }];

  const res = await fetch(`${BASE}/${model}:generateContent?key=${encodeURIComponent(settings.apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    let msg = `Gemini error ${res.status}`;
    try {
      msg = JSON.parse(errText)?.error?.message ?? msg;
    } catch { /* keep default */ }
    throw new Error(msg);
  }
  const data = await res.json();
  const tokens = data?.usageMetadata?.totalTokenCount;
  if (typeof tokens === 'number' && tokens > 0) {
    try {
      window.dispatchEvent(new CustomEvent('yok-tokens', { detail: tokens }));
    } catch { /* non-browser env */ }
  }
  const outParts: Part[] = data?.candidates?.[0]?.content?.parts ?? [];
  const text = outParts.map((p) => p.text ?? '').join('');
  const img = outParts.find((p) => p.inlineData?.data);
  const chunks = data?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const sources = chunks
    .map((c: { web?: { title?: string; uri?: string } }) => c.web)
    .filter((w: { uri?: string } | undefined): w is { title?: string; uri: string } => !!w?.uri)
    .map((w: { title?: string; uri: string }) => ({ title: w.title ?? w.uri, uri: w.uri }));
  return {
    text,
    imageData: img ? `data:${img.inlineData!.mimeType};base64,${img.inlineData!.data}` : undefined,
    sources,
  };
}

function safeParseJSON<T>(raw: string): T {
  // strip fences if present, find first { or [
  const cleaned = raw.replace(/```json|```/g, '').trim();
  const start = Math.min(
    ...['{', '['].map((c) => {
      const i = cleaned.indexOf(c);
      return i === -1 ? Infinity : i;
    }),
  );
  const sliced = start === Infinity ? cleaned : cleaned.slice(start);
  return JSON.parse(sliced) as T;
}

// ---------- context builders ----------

function bookContext(book: Book): string {
  const toc = book.pages
    .map((p, i) => `${i + 1}. [${p.id}] "${p.title}" (${p.chapter}) — ${p.summary}${p.drafted ? '' : ' (not yet drafted)'}`)
    .join('\n');
  const openNotes = book.notes.filter((n) => !n.resolved)
    .map((n) => `- (page ${book.pages.find((p) => p.id === n.pageId)?.title ?? '?'}) ${n.text}`)
    .join('\n');
  const iv = (book.plan.interview ?? []).map((x) => `Q: ${x.q}\nA: ${x.a}`).join('\n');
  return [
    `PROJECT BOOK: "${book.title}"${book.subtitle ? ` — ${book.subtitle}` : ''}`,
    `CREATOR'S ORIGINAL PLAN:\n${book.plan.prompt}`,
    book.plan.vibe ? `VIBE / REFERENCES: ${book.plan.vibe}` : '',
    iv ? `PLANNING INTERVIEW:\n${iv}` : '',
    `TABLE OF CONTENTS (with page ids):\n${toc}`,
    openNotes ? `OPEN NOTES / UNRESOLVED TASKS:\n${openNotes}` : '',
  ].filter(Boolean).join('\n\n');
}

function blocksJSON(blocks: Block[]): string {
  return JSON.stringify(
    blocks.map(({ id, type, text, items, imagePrompt, caption }) => ({ id, type, text, items, imagePrompt, caption })),
  );
}

const BLOCK_SPEC = `Each block is an object: {"type": "heading"|"paragraph"|"quote"|"list"|"image", "text": string (for heading/paragraph/quote), "items": string[] (for list), "imagePrompt": string (for image — a rich visual description for an image generator), "caption": string (optional, for image)}. Pages should read like a beautifully edited book page: a heading, strong prose paragraphs, occasional pull-quotes, lists where useful, and 1-3 image blocks placed where a visual belongs.`;

const ACTION_SPEC = `If (and only if) the user asks you to change, add to, or rewrite canvas content, end your reply with a fenced json block:
\`\`\`json
{"actions":[{"action":"update_page","pageId":"<id>","blocks":[...]} | {"action":"add_notes","notes":[{"pageId":"<id>","text":"..."}]}]}
\`\`\`
For update_page, return the COMPLETE new list of blocks for that page (carry over blocks that don't change, keeping their "id" so images are preserved; new blocks get no id). ${BLOCK_SPEC}
Speak concisely in the prose part — the canvas is the deliverable, chat is the conversation.`;

function parseActions(raw: string): ChatResult {
  const m = raw.match(/```json\s*([\s\S]*?)```\s*$/);
  let actions: AgentAction[] = [];
  let text = raw;
  if (m) {
    try {
      const parsed = JSON.parse(m[1]);
      actions = parsed.actions ?? [];
      text = raw.slice(0, m.index).trim();
    } catch { /* leave as text */ }
  }
  return { text, actions };
}

// ---------- public API ----------

export async function generateOutline(settings: Settings, plan: { prompt: string; vibe?: string; interview?: { q: string; a: string }[] }): Promise<OutlineResult> {
  const iv = (plan.interview ?? []).map((x) => `Q: ${x.q}\nA: ${x.a}`).join('\n');
  const prompt = `You are a world-class story/creative-project architect helping a creator turn an idea into a living project book.

THE IDEA:
${plan.prompt}
${plan.vibe ? `\nVIBE / REFERENCES: ${plan.vibe}` : ''}
${iv ? `\nPLANNING INTERVIEW:\n${iv}` : ''}

First, silently reason about the best way to structure a project book for THIS idea — what a professional in this domain would need to think through (world, characters, tone, acts, production, style bible, shot design, etc. for a film; adapt for other kinds of projects). Then produce a table of contents of 12 to 20 pages that takes the creator from vision to executable plan, from macro (premise, themes) to micro (scenes, look, production details).

Return ONLY JSON:
{"title": "evocative book title — 2 to 5 words, Title Case (never ALL CAPS), punchy enough for a spine", "subtitle": "one-line subtitle", "coverArt": "a rich, textless art direction for this book's cover artwork — subject, mood, palette, composition; NO text or lettering in the image", "pages": [{"chapter": "Part name (group pages into 3-5 parts)", "title": "page title", "summary": "2-3 sentences on exactly what this page will contain", "imageIdeas": ["1-2 short image concepts for this page"]}]}`;
  const { text } = await call(settings, settings.textModel, [{ text: prompt }], { json: true });
  return safeParseJSON<OutlineResult>(text);
}

export async function draftPage(settings: Settings, book: Book, page: Page): Promise<Block[]> {
  const prompt = `${bookContext(book)}

You are drafting ONE page of this project book: "${page.title}" (${page.chapter}).
Page brief: ${page.summary}

Write the full, polished content of this page. It must be concrete and specific to this project — real names, real decisions, vivid prose. 250-450 words of text total across blocks, plus 1-3 image blocks with rich imagePrompts (include style keywords consistent with the project's visual identity).

Return ONLY JSON: {"blocks": [...]}. ${BLOCK_SPEC}`;
  const { text } = await call(settings, settings.textModel, [{ text: prompt }], { json: true });
  const parsed = safeParseJSON<{ blocks: Block[] }>(text);
  return (parsed.blocks ?? []).map((b) => ({ ...b, id: b.id || uid() }));
}

export async function chatTurn(
  settings: Settings,
  book: Book,
  page: Page | null, // null = book-level (cover) chat
  history: Msg[],
  userText: string,
): Promise<ChatResult> {
  const scope = page
    ? `You are working on the page "${page.title}" [id ${page.id}]. Its current canvas content (JSON blocks): ${blocksJSON(page.blocks)}\nYour context is primarily THIS page; you also know the rest of the book from the TOC above.`
    : `You are at the BOOK level (the creator is talking to the whole book, not one page). You may propose changes to any page(s) by id, add notes to pages, or restructure the table of contents with {"action":"update_toc","pages":[{"pageId":"<id to change>","title":"...","summary":"...","chapter":"..."} | {"title":"...","summary":"...","chapter":"..."} (no pageId = append a NEW page)]}. Only include fields you are changing.`;
  const sys = `${bookContext(book)}

You are the creator's editor-in-residence living inside this book. Be sharp, collaborative, and opinionated in service of their vision. You can brainstorm, research angles, punch up prose, restructure.

${scope}

${ACTION_SPEC}`;
  const hist = history.slice(-12).map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] }));
  const { text } = await call(settings, settings.textModel, [{ text: userText }], {
    history: [{ role: 'user', parts: [{ text: sys }] }, { role: 'model', parts: [{ text: 'Understood. I have the full book context. Ready.' }] }, ...hist],
  });
  return parseActions(text);
}

export async function generateCoverArt(settings: Settings, artDirection: string): Promise<string> {
  const prompt = `${artDirection}. Book cover artwork: portrait composition, painterly, rich detail, dramatic light, full-bleed. Absolutely NO text, NO lettering, NO typography, NO title — pure artwork only (the title is typeset separately).`;
  const doCall = (aspect?: string) => call(settings, settings.imageModel, [{ text: prompt }], { imageOut: true, aspect });
  let res;
  try {
    res = await doCall('3:4');
  } catch {
    res = await doCall(); // model may not support imageConfig
  }
  if (!res.imageData) throw new Error('No cover image returned');
  return res.imageData;
}

export async function generateImage(settings: Settings, prompt: string, bookTitle?: string): Promise<string> {
  const { imageData } = await call(
    settings,
    settings.imageModel,
    [{ text: `${prompt}${bookTitle ? ` — illustration for the project book "${bookTitle}". Cohesive, cinematic, high production value.` : ''}` }],
    { imageOut: true },
  );
  if (!imageData) throw new Error('No image returned');
  return imageData;
}

export async function editImage(settings: Settings, markedImageDataUrl: string, instruction: string): Promise<string> {
  const [meta, b64] = markedImageDataUrl.split(',');
  const mime = meta.match(/data:(.*?);/)?.[1] ?? 'image/png';
  const { imageData } = await call(
    settings,
    settings.imageModel,
    [
      { inlineData: { mimeType: mime, data: b64 } },
      { text: `The red markings on this image are the creator's annotations pointing at what to change. Apply this direction and regenerate the image cleanly WITHOUT any of the red markings: ${instruction}` },
    ],
    { imageOut: true },
  );
  if (!imageData) throw new Error('No image returned');
  return imageData;
}

export async function brainDump(settings: Settings, book: Book, dump: string): Promise<BrainDumpAssignment[]> {
  const prompt = `${bookContext(book)}

The creator has dumped raw notes kept elsewhere. Sort every meaningful piece into the most relevant page of the book. Return ONLY JSON:
{"assignments": [{"pageId": "<id from TOC>", "noteText": "the cleaned-up note, preserving the creator's intent"}]}

RAW NOTES:
${dump}`;
  const { text } = await call(settings, settings.textModel, [{ text: prompt }], { json: true });
  const parsed = safeParseJSON<{ assignments: { pageId: string; noteText: string }[] }>(text);
  return (parsed.assignments ?? []).map((a) => ({
    ...a,
    pageTitle: book.pages.find((p) => p.id === a.pageId)?.title ?? 'Unknown page',
  }));
}

export async function auditReadSession(
  settings: Settings,
  book: Book,
  page: Page,
  annotations: Annotation[],
  transcript: TranscriptSeg[],
  snapshotDataUrl: string | null,
  extraNote?: string,
): Promise<ChatResult> {
  const annDesc = annotations.map((a) => {
    const near = transcript
      .filter((s) => a.t !== undefined && Math.abs(s.t - a.t) < 10)
      .map((s) => s.text).join(' ');
    return `- ${a.tool} at ~${Math.round(a.t ?? 0)}s${near ? ` — creator was saying: "${near}"` : ''}`;
  }).join('\n');
  const parts: Part[] = [];
  if (snapshotDataUrl) {
    const [meta, b64] = snapshotDataUrl.split(',');
    parts.push({ inlineData: { mimeType: meta.match(/data:(.*?);/)?.[1] ?? 'image/png', data: b64 } });
  }
  parts.push({
    text: `${bookContext(book)}

READ SESSION AUDIT for page "${page.title}" [id ${page.id}].
The creator just read this page aloud while marking it up${snapshotDataUrl ? ' (see the attached snapshot with their ink)' : ''}.

Current canvas blocks: ${blocksJSON(page.blocks)}

Their annotations, synced to what they were saying at that moment:
${annDesc || '(no annotations — go off the transcript)'}

Full transcript: ${transcript.map((s) => s.text).join(' ') || '(no voice captured)'}
${extraNote ? `\nThe creator reviewed this audit and added: "${extraNote}" — weigh this instruction heavily.` : ''}

Synthesize their intent and revise the page. If an annotation targets an image and asks for a visual change, update that image block's imagePrompt to the revised description and REMOVE its old "id" so a fresh image is generated. Reply with a short summary of what you changed and why, then the actions block. ${ACTION_SPEC}`,
  });
  const { text } = await call(settings, settings.textModel, parts, {});
  return parseActions(text);
}

/** Verify a key: list models and confirm the configured text + image models are reachable. */
export async function testKey(settings: Settings): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`${BASE}?key=${encodeURIComponent(settings.apiKey)}&pageSize=200`);
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      let msg = `key rejected (${res.status})`;
      try { msg = JSON.parse(t)?.error?.message ?? msg; } catch { /* keep */ }
      return { ok: false, message: msg };
    }
    const data = await res.json();
    const names: string[] = (data.models ?? []).map((m: { name: string }) => m.name.replace('models/', ''));
    const hasText = names.includes(settings.textModel);
    const hasImage = names.includes(settings.imageModel);
    if (!hasText || !hasImage) {
      return { ok: false, message: `Key valid, but ${!hasText ? settings.textModel : settings.imageModel} isn't available to it.` };
    }
    return { ok: true, message: `Key valid — writing (${settings.textModel}) and image (${settings.imageModel}) models ready.` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export interface StudioRun {
  model: string;
  temperature?: number;
  maxOutputTokens?: number;
  thinking?: 'auto' | 'low' | 'high';
  system?: string;
  context?: string;
  aspect?: string;
}

/** Create-tab: generate a standalone image asset (Google AI Studio, wrapped in a book). */
export async function createImage(settings: Settings, prompt: string, run: StudioRun): Promise<string> {
  const full = `${run.context ? `Project context: ${run.context}\n\n` : ''}${prompt}`;
  const doCall = (aspect?: string) => call(settings, run.model, [{ text: full }], {
    imageOut: true, aspect, temperature: run.temperature,
  });
  let res;
  try {
    res = await doCall(run.aspect);
  } catch {
    res = await doCall();
  }
  if (!res.imageData) throw new Error('No image returned');
  return res.imageData;
}

/** Create-tab: generate standalone text (treatments, loglines, lyrics, anything). */
export async function createText(settings: Settings, prompt: string, run: StudioRun): Promise<string> {
  const parts = [{ text: `${run.context ? `Project context (write in service of this project):\n${run.context}\n\n` : ''}${prompt}` }];
  const opts = {
    temperature: run.temperature, maxOutputTokens: run.maxOutputTokens,
    thinking: run.thinking, system: run.system || undefined,
  };
  try {
    const { text } = await call(settings, run.model, parts, opts);
    return text;
  } catch (e) {
    // some models reject thinkingConfig — retry clean before failing
    if (opts.thinking && opts.thinking !== 'auto') {
      const { text } = await call(settings, run.model, parts, { ...opts, thinking: undefined });
      return text;
    }
    throw e;
  }
}

export async function research(
  settings: Settings,
  book: Book,
  page: Page | null,
  history: Msg[],
  userText: string,
  opts: { deep?: boolean; auditNote?: string; attachments?: { mimeType: string; data: string }[]; model?: string } = {},
): Promise<ResearchResult> {
  const scope = page
    ? `The creator is researching for the page "${page.title}": ${page.summary}. Current page content: ${blocksJSON(page.blocks)}`
    : `The creator is researching at the whole-book level.`;
  const sys = `${bookContext(book)}

You are the creator's research partner living inside this project book. Use Google Search for live, current information. Brainstorm, compare, cite. You do NOT edit the book from here — this is the thinking room.
${scope}
${opts.auditNote ? `\nContext from their latest page audit:\n${opts.auditNote}` : ''}
${opts.deep ? '\nThis is a DEEP RESEARCH request: produce a thorough, structured report (clear sections, findings, sources, and a short "what this means for the project" conclusion).' : '\nKeep answers sharp and conversational.'}`;
  const hist = history.slice(-10).map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] }));
  const model = opts.deep ? 'gemini-pro-latest' : (opts.model || settings.textModel);
  const userParts: Part[] = [
    ...(opts.attachments ?? []).map((a) => ({ inlineData: { mimeType: a.mimeType, data: a.data } })),
    { text: userText },
  ];
  const res = await call(settings, model, userParts, {
    search: true,
    history: [{ role: 'user', parts: [{ text: sys }] }, { role: 'model', parts: [{ text: 'Understood — research mode, live search on.' }] }, ...hist],
  });
  return { text: res.text, sources: (res as { sources?: { title: string; uri: string }[] }).sources ?? [] };
}

export async function interviewQuestions(settings: Settings, prompt: string): Promise<string[]> {
  const p = `A creator wants to start a project book with this idea:\n"${prompt}"\n\nAsk the 5 sharpest questions that would make the project plan dramatically better — mix of macro (theme, audience, arc) and micro (style, constraints, format). Return ONLY JSON: {"questions": ["...", ...]}`;
  const { text } = await call(settings, settings.textModel, [{ text: p }], { json: true });
  return safeParseJSON<{ questions: string[] }>(text).questions ?? [];
}
