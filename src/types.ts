/**
 * Pangea — core data model.
 *
 * Everything the app persists lives in a `Book`: pages, chat history (per
 * scope: page Scribe, page/book Research, book-level Notes), a changelog
 * (`logs`), generated `assets` (images/writings/reports), and per-book AI
 * Studio run settings (`studio`). See src/storage.ts for how Book[] is
 * persisted (IndexedDB via Dexie, with an in-memory fallback).
 *
 * `AgentAction` is the contract between the model's chat replies and the
 * app: the Scribe/Research/Create model can end a reply with a fenced
 * ```json {"actions": [...]}``` block (parsed in src/gemini.ts) telling the
 * app to update page blocks, restructure the TOC, or add notes — see
 * src/actions.ts for how those get applied to a Book.
 */

// ---------- Core data model ----------

export type BlockType = 'heading' | 'paragraph' | 'quote' | 'list' | 'image';

export interface Block {
  id: string;
  type: BlockType;
  text?: string;
  items?: string[];
  imagePrompt?: string;
  imageData?: string; // data URL (generated or procedural placeholder)
  caption?: string;
}

export type Tool = 'cursor' | 'pen' | 'highlight' | 'underline' | 'circle' | 'note' | 'erase';

export interface Annotation {
  id: string;
  tool: 'pen' | 'highlight' | 'underline' | 'circle';
  color: string;
  /** normalized x (0..1 of content width), y in px within content flow */
  points: { x: number; y: number }[];
  createdAt: number;
  sessionId?: string;
  /** seconds since read-session start */
  t?: number;
}

export interface Note {
  id: string;
  pageId: string;
  text: string;
  resolved: boolean;
  createdAt: number;
  x?: number; // normalized
  y?: number; // px in content flow
}

export interface Msg {
  id: string;
  role: 'user' | 'model';
  text: string;
  ts: number;
  meta?: string; // e.g. "canvas-updated", "audit"
  sources?: { title: string; uri: string }[];
  attachmentNames?: string[];
}

export interface Page {
  id: string;
  chapter: string;
  title: string;
  summary: string;
  blocks: Block[];
  annotations: Annotation[];
  drafted: boolean;
}

export interface InterviewQA {
  q: string;
  a: string;
}

export interface BookPlan {
  prompt: string;
  vibe?: string;
  interview?: InterviewQA[];
}

export type LogKind = 'draft' | 'canvas' | 'image' | 'cover' | 'rename' | 'note' | 'audit' | 'research' | 'toc' | 'dump' | 'create';

export interface LogEntry {
  id: string;
  ts: number;
  pageId?: string;
  kind: LogKind;
  summary: string;
}

export interface Asset {
  id: string;
  ts: number;
  pageId?: string; // undefined = book-level
  type: 'report' | 'image' | 'text';
  title: string;
  content: string; // report/text body; caption for images
  imageData?: string; // data URL for image assets
}

export interface Attachment {
  name: string;
  mimeType: string;
  data: string; // base64 (no data: prefix)
}

export interface Book {
  id: string;
  title: string;
  subtitle?: string;
  author?: string;
  palette: number;
  font: number;
  createdAt: number;
  updatedAt: number;
  /** last time the book was opened / placed on the desk */
  lastOpenedAt?: number;
  /** AI-generated cover artwork (data URL, portrait) — typography is overlaid by the app */
  coverImage?: string;
  /** the art direction used for the current cover */
  coverPrompt?: string;
  /** cumulative Gemini tokens spent on this book */
  tokensSpent?: number;
  plan: BookPlan;
  pages: Page[];
  notes: Note[];
  bookChat: Msg[];
  pageChats: Record<string, Msg[]>;
  /** research/brainstorm chats, keyed by pageId or 'book' */
  researchChats?: Record<string, Msg[]>;
  logs?: LogEntry[];
  assets?: Asset[];
  /** AI-studio run settings, persisted per book */
  studio?: StudioPrefs;
  demo?: boolean;
}

export interface StudioPrefs {
  textModel: string;
  imageModel: string;
  temperature: number; // 0..2
  maxOutputTokens: number;
  thinking: 'auto' | 'low' | 'high';
  systemInstruction: string;
  aspect: string;
  researchModel: string;
}

export const DEFAULT_STUDIO: StudioPrefs = {
  textModel: 'gemini-3.6-flash',
  imageModel: 'gemini-3.1-flash-image',
  temperature: 1.0,
  maxOutputTokens: 8192,
  thinking: 'auto',
  systemInstruction: '',
  aspect: '16:9',
  researchModel: 'gemini-flash-latest',
};

export const TEXT_MODELS = [
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
  { id: 'gemini-flash-latest', label: 'Gemini Flash (latest)' },
  { id: 'gemini-pro-latest', label: 'Gemini Pro (latest)' },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite' },
];

export const IMAGE_MODELS = [
  { id: 'gemini-3.1-flash-image', label: 'Nano Banana 2 (3.1 Flash Image)' },
  { id: 'gemini-3-pro-image', label: 'Nano Banana Pro (3 Pro Image)' },
  { id: 'gemini-3.1-flash-lite-image', label: 'Nano Banana Lite' },
];

export interface Settings {
  apiKey: string;
  textModel: string;
  imageModel: string;
  authorName: string;
}

// ---------- AI protocol ----------

export interface OutlinePageSpec {
  chapter: string;
  title: string;
  summary: string;
  imageIdeas: string[];
}

export interface OutlineResult {
  title: string;
  subtitle: string;
  /** rich, textless art direction for the book's cover */
  coverArt?: string;
  pages: OutlinePageSpec[];
}

export type AgentAction =
  | { action: 'update_page'; pageId?: string; blocks: Block[] }
  | { action: 'update_pages'; pages: { pageId: string; blocks: Block[] }[] }
  | { action: 'add_notes'; notes: { pageId: string; text: string }[] }
  | { action: 'update_toc'; pages: { pageId?: string; title?: string; summary?: string; chapter?: string }[] };

export interface ChatResult {
  text: string;
  actions: AgentAction[];
}

export interface BrainDumpAssignment {
  pageId: string;
  pageTitle: string;
  noteText: string;
}

export interface ResearchResult {
  text: string;
  sources: { title: string; uri: string }[];
}

/** Compiled result of a page audit, staged into the Scribe input for review. */
export interface PendingAudit {
  pageId: string;
  annotations: Annotation[];
  transcript: TranscriptSeg[];
  snapshot: string | null;
  draftText: string;
}

// ---------- Read session ----------

export interface TranscriptSeg {
  t: number; // seconds since session start
  text: string;
}

export interface ReadSessionState {
  id: string;
  startedAt: number;
  transcript: TranscriptSeg[];
  listening: boolean;
  annotationIds: string[];
}

// ---------- helpers ----------

export const uid = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
