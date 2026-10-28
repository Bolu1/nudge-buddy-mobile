// Turn-taking text helpers — ported unchanged from the web app's voice-context.
// Recognition mishears the assistant's own voice, so echo matching is fuzzy.

const BACKCHANNELS = new Set([
  "mm", "mmm", "hmm", "mhm", "mmhmm", "mm-hmm", "uh-huh", "uh", "huh", "ah", "oh",
  "yeah", "yep", "ok", "okay", "right", "sure", "cool", "nice", "great", "alright", "gotcha", "got", "it",
]);
export const TRAILING_RE = /\b(and|but|so|or|um|uh|erm|because|like|the|a|an|to|with|then|of|for|my|is|can|could|would|will|should|please|what|how|when|where|let|want|need|add|set|start|make|remind)\s*$/i;
// Short phrases that are a whole turn on their own. Anything else that short
// ("can you", "set a") is treated as the user still forming the sentence.
const COMPLETE_SHORT = new Set([
  "hi", "hello", "hey", "yo", "thanks", "thank you", "thanks a lot", "cheers", "yes", "yeah", "yep", "no", "nope",
  "ok", "okay", "sure", "stop", "cancel", "never mind", "nevermind", "bye", "goodbye", "good night",
  "pause", "resume", "go ahead", "do it", "that's it", "that's all", "got it", "sounds good", "perfect", "great",
]);
export const isCompleteShort = (s: string) => COMPLETE_SHORT.has(normWords(s).join(" ").replace(/[^a-z' ]/g, "").trim());

export type InterruptedInfo = { spokenSoFar: string; fullText: string };
export type TranscriptMeta = { interrupted?: InterruptedInfo };

export function normWords(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9'\s-]/g, " ").split(/\s+/).filter(Boolean);
}

// "mm-hmm", "yeah", "okay" while the assistant talks = listening, not interrupting
export function isBackchannel(s: string): boolean {
  const words = normWords(s);
  return words.length > 0 && words.length <= 3 && words.every((w) => BACKCHANNELS.has(w));
}

export const INTERRUPT_WORDS = new Set(["stop", "wait", "hold", "hang", "pause", "cancel", "no", "nope", "actually", "sorry", "enough"]);

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

// Recognition mishears the assistant's voice coming back through the speakers
// ("timers" → "time", "there" → "that"), so echo matching has to be fuzzy.
export function soundsLikeSaid(w: string, said: string[], saidSet: Set<string>): boolean {
  if (saidSet.has(w)) return true;
  if (INTERRUPT_WORDS.has(w)) return false; // only an exact match counts for "stop", "wait"…
  const a = w.replace(/'.*$/, "");
  if (a.length < 3) return false;
  return said.some((s) => {
    const b = s.replace(/'.*$/, "");
    if (b.length < 3) return false;
    if (a === b || a.startsWith(b) || b.startsWith(a)) return true;
    return a.length >= 4 && b.length >= 4 && editDistance(a, b) <= 1;
  });
}

// Split what the mic heard into echo vs. the user's own words. Misheard echo
// shows up as isolated odd words; a real person produces a run of new words.
export function analyzeHeard(heard: string, spoken: string) {
  const words = normWords(heard);
  const said = spoken ? normWords(spoken) : [];
  const saidSet = new Set(said);
  const isUser = words.map((w) => !said.length || !soundsLikeSaid(w, said, saidSet));
  const userWords = words.filter((_, i) => isUser[i]);
  let maxRun = 0, run = 0;
  for (const u of isUser) { run = u ? run + 1 : 0; maxRun = Math.max(maxRun, run); }
  const hasInterrupt = userWords.some((w) => INTERRUPT_WORDS.has(w));
  // Mostly the assistant's words with only scattered mishearings → echo
  const isEcho = userWords.length === 0 || (words.length >= 3 && maxRun < 2 && !hasInterrupt);
  return { words, userWords, maxRun, hasInterrupt, isEcho };
}

// Split a reply into sentence-sized chunks so the first one can be synthesized
// and played while the rest are still being fetched. Tiny fragments are merged
// forward so we don't fire a request for "Done!" alone.
export function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?…]+(?:[.!?…]+["')\]]*|$)\s*/g)?.map((p) => p.trim()).filter(Boolean) ?? [];
  const out: string[] = [];
  let acc = "";
  for (const p of parts) {
    acc = acc ? `${acc} ${p}` : p;
    if (acc.length >= 25) { out.push(acc); acc = ""; }
  }
  if (acc) {
    if (out.length && acc.length < 12) out[out.length - 1] += ` ${acc}`;
    else out.push(acc);
  }
  return out.length ? out : (text.trim() ? [text.trim()] : []);
}

