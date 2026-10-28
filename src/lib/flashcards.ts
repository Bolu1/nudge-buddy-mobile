import { Avatar, Style } from "@dicebear/core";
import patchwork from "@dicebear/styles/patchwork.json";
import shapeGrid from "@dicebear/styles/shape-grid.json";
import constellation from "@dicebear/styles/constellation.json";
import planets from "@dicebear/styles/planets.json";
import waves from "@dicebear/styles/waves.json";

// Same types and helpers as the web app's lib/flashcards.ts. DiceBear needs
// structuredClone, which Expo's runtime installs on native.

export type FlashcardTheme = "PATCHWORK" | "SHAPE_GRID" | "CONSTELLATION" | "PLANETS" | "WAVES";
export type StudyMode = "ALL" | "MISSED";

export const MAX_CARDS = 50;
export const QUESTION_MAX = 300;
export const ANSWER_MAX = 1000;

export interface Flashcard {
  id: string;
  question: string;
  answer: string;
  position: number;
  /** Result from the most recent session that included this card; null if never studied. */
  lastCorrect: boolean | null;
}

export interface SessionSummary {
  id: string;
  mode: StudyMode;
  totalCards: number;
  correctCards: number;
  scorePct: number;
  durationMs: number;
  avgMs: number;
  startedAt: string;
  completedAt: string;
}

export interface CollectionSummary {
  id: string;
  title: string;
  description: string | null;
  theme: FlashcardTheme;
  cardCount: number;
  lastSession: SessionSummary | null;
  updatedAt: string;
}

export interface CollectionDetail extends Omit<CollectionSummary, "cardCount"> {
  cards: Flashcard[];
}

export interface SessionResult {
  session: SessionSummary;
  previous: SessionSummary | null;
  improved: { id: string; question: string }[];
  slipped: { id: string; question: string }[];
}

export const THEMES: { value: FlashcardTheme; label: string }[] = [
  { value: "PATCHWORK", label: "Patchwork" },
  { value: "SHAPE_GRID", label: "Shape grid" },
  { value: "CONSTELLATION", label: "Constellation" },
  { value: "PLANETS", label: "Planets" },
  { value: "WAVES", label: "Waves" },
];

const STYLE_DEFS: Record<FlashcardTheme, unknown> = {
  PATCHWORK: patchwork,
  SHAPE_GRID: shapeGrid,
  CONSTELLATION: constellation,
  PLANETS: planets,
  WAVES: waves,
};

const styles = new Map<FlashcardTheme, Style>();
const svgCache = new Map<string, string>();

/**
 * Deterministic DiceBear background for a card (or collection), seeded by its id.
 * Returned as SVG markup for SvgXml, set to cover its box (the styles are square).
 */
export function themeBackground(theme: FlashcardTheme, seed: string): string {
  const key = `${theme}:${seed}`;
  const cached = svgCache.get(key);
  if (cached) return cached;
  let style = styles.get(theme);
  if (!style) {
    style = new Style(STYLE_DEFS[theme] as ConstructorParameters<typeof Style>[0]);
    styles.set(theme, style);
  }
  const svg = new Avatar(style, { seed })
    .toString()
    // Licence metadata is dead weight for the native SVG parser
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<metadata[\s\S]*?<\/metadata>/, "")
    .replace("<svg ", '<svg preserveAspectRatio="xMidYMid slice" ');
  svgCache.set(key, svg);
  return svg;
}

export function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Mirrors the server's upload rules so bad files fail before they're sent
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_MAX_PAGES = 30;
/** Types offered in the system picker; the extension check below is what's enforced. */
export const DOCUMENT_PICKER_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
];
const DOCUMENT_EXTENSIONS = ["pdf", "docx", "txt", "md"];

export function documentFileError(file: { name: string; size?: number }): string | null {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (ext === "doc") return "Old Word (.doc) files aren't supported. Save it as .docx or PDF first.";
  if (!DOCUMENT_EXTENSIONS.includes(ext)) return "Choose a PDF, Word (.docx), .txt or .md file.";
  if (file.size != null && file.size > DOCUMENT_MAX_BYTES) return "Files can be at most 10 MB.";
  if (file.size === 0) return "This file is empty.";
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type ScoreTone = "good" | "average" | "bad";

/** 80%+ is good, 50–79% average, below 50% needs work — same bands as the web app. */
export function scoreTone(pct: number): ScoreTone {
  if (pct >= 80) return "good";
  if (pct >= 50) return "average";
  return "bad";
}

export const SCORE_COLOR: Record<ScoreTone, string> = {
  good: "#8fc78a",
  average: "#e9c46a",
  bad: "#f0806f",
};
