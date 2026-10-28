// Note content is stored as an opaque string: plain text for quick-capture
// notes, or HTML for notes written in the rich editor (Tiptap on the web,
// the WebView editor here). These helpers give every surface readable text.

export function isRichContent(content: string): boolean {
  return /<[a-z][\s\S]*>/i.test(content);
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

function decodeEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m);
}

export function htmlToText(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

/** Top-level blocks (<p>, <h1>, <li>…) as plain text lines */
function htmlBlocks(html: string): string[] {
  return html
    .split(/<\/(?:p|h[1-6]|li|blockquote|pre|div)>|<br\s*\/?>/i)
    .map((chunk) => htmlToText(chunk))
    .filter(Boolean);
}

/**
 * First line/block as a short title, remaining content as a body preview —
 * non-overlapping, unlike naively truncating the whole flattened text twice.
 */
export function splitNotePreview(content: string): { title: string; body: string } {
  if (!isRichContent(content)) {
    const lines = content.trim().split("\n");
    return { title: truncate(lines[0] || "", 60) || "Untitled note", body: lines.slice(1).join("\n").trim() };
  }
  const blocks = htmlBlocks(content);
  return {
    title: truncate(blocks[0] || "", 60) || "Untitled note",
    body: blocks.slice(1).join(" ").trim(),
  };
}
