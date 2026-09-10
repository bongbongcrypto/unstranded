// Break a narration line into the short bursts the video burns in, one at a
// time, large. This lives on its own so scripts/check-pops.mjs can read the
// same code the generator uses; the first three versions of this splitter each
// shipped a caption that the frame cut off, and each was "checked" by eye.
//
// What a burst has to be:
//   - narrower than the line it is drawn on. The Pop style does not wrap
//     (WrapStyle 2), so a burst wider than the frame is cut off at both ends,
//     not folded. Widths are estimated from a per-character table and proved
//     by scripts/check-captions.mjs, which renders them.
//   - short enough to read in one look: about five words or thirty odd
//     characters, and never a lone word, which reads as a glitch.
//   - broken where a reader would break: after punctuation first, never on a
//     word that leans on the next one, and never inside a spelled out number.
//     "two hundred and seventy one" is one thing and travels as one token.

export const LEANS_FORWARD = new Set([
  "a", "an", "the", "and", "or", "but", "so", "of", "to", "in", "on", "at", "for",
  "from", "with", "into", "that", "which", "who", "is", "are", "was", "were", "be",
  "it", "its", "this", "these", "those", "you", "we", "they", "their", "your", "no",
  "not", "as", "by", "than", "then", "when", "what", "how", "someone", "anyone",
  "everyone", "per",
]);

// Number words. A run of these, joined by "and" or "point" where a number is
// read that way, is one token to the splitter.
export const NUMBER_WORDS = new Set([
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty",
  "sixty", "seventy", "eighty", "ninety", "hundred", "thousand", "million",
  "half", "quarter",
]);

export const MAX_POP_WORDS = 5;
export const MAX_POP_CHARS = 34;
export const MIN_POP_CHARS = 13;

// The width of a burst in the pixels libass draws it at: the advance of each
// character of Arial Black at 96, read from the font file, scaled by
// 0.7066, which is the ratio libass draws at against the font's own units.
// Checked against 89 rendered captions; the estimate is within 7px of the
// measurement on every one. A character outside the table is charged as an "n".
export const POP_PX = {
  " ": 22.61, "!": 22.61, "\"": 33.92, "#": 44.52, "$": 45.22, "%": 67.83,
  "&": 60.06, "'": 19.08, "(": 26.14, ")": 26.14, "*": 37.45, "+": 44.52,
  ",": 22.61, "-": 22.61, ".": 22.61, "/": 19.08, "0": 45.22, "1": 45.22,
  "2": 45.22, "3": 45.22, "4": 45.22, "5": 45.22, "6": 45.22, "7": 45.22,
  "8": 45.22, "9": 45.22, ":": 22.61, ";": 22.61, "<": 44.52, "=": 44.52,
  ">": 44.52, "?": 41.69, "@": 50.17, "A": 52.99, "B": 52.99, "C": 52.99,
  "D": 52.99, "E": 48.76, "F": 45.22, "G": 56.53, "H": 56.53, "I": 26.14,
  "J": 45.22, "K": 56.53, "L": 45.22, "M": 64.3, "N": 56.53, "O": 56.53,
  "P": 48.76, "Q": 56.53, "R": 52.99, "S": 48.76, "T": 48.76, "U": 56.53,
  "V": 52.99, "W": 67.83, "X": 52.99, "Y": 52.99, "Z": 48.76, "[": 26.14,
  "\\": 19.08, "]": 26.14, "^": 44.52, "_": 33.92, "`": 22.61, "a": 45.22,
  "b": 45.22, "c": 45.22, "d": 45.22, "e": 45.22, "f": 26.14, "g": 45.22,
  "h": 45.22, "i": 22.61, "j": 22.61, "k": 45.22, "l": 22.61, "m": 67.83,
  "n": 45.22, "o": 45.22, "p": 45.22, "q": 45.22, "r": 30.38, "s": 41.69,
  "t": 30.38, "u": 45.22, "v": 41.69, "w": 64.3, "x": 45.22, "y": 41.69,
  "z": 37.45, "{": 26.14, "|": 19.08, "}": 26.14, "~": 44.52,
};
// The style's margins leave 1640px, and each burst is scaled to 112% for its
// first two frames, so 1450px at rest keeps the pop-in inside the margins.
export const POP_LINE_PX = 1450;
export const popWidth = (s) => [...s].reduce((n, c) => n + (POP_PX[c] ?? POP_PX.n), 0);
export const fits = (s) => popWidth(s) <= POP_LINE_PX;

export const bare = (w) => w.toLowerCase().replace(/[^a-z]/g, "");
export const closes = (w) => /[.,;:?!]$/.test(w);
/** A word that ends a clause never leans on the next one, whatever it is. */
export const leansOn = (w) => !closes(w) && LEANS_FORWARD.has(bare(w));
const isNumber = (w) => NUMBER_WORDS.has(bare(w));

/**
 * Words, with each spelled out number folded into one token. "two hundred and
 * seventy one" comes back as a single string; "one" on its own stays a word.
 * A number stops at punctuation, so "fifteen. Ten" is two tokens.
 */
export function atoms(words) {
  const out = [];
  let i = 0;
  while (i < words.length) {
    if (!isNumber(words[i])) {
      out.push(words[i]);
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < words.length && !closes(words[j - 1])) {
      if (isNumber(words[j])) { j += 1; continue; }
      const joiner = bare(words[j]);
      if ((joiner === "and" || joiner === "point") && j + 1 < words.length && isNumber(words[j + 1])) {
        j += 2;
        continue;
      }
      break;
    }
    out.push(words.slice(i, j).join(" "));
    i = j;
  }
  return out;
}

const words = (s) => s.split(" ").length;

/**
 * The bursts for one narration line, in order. A burst that has to run to two
 * lines carries a "\N" between them, which the style honours; that only
 * happens when a single token is wider than the line, which no line of the
 * current script produces.
 */
export function pops(text) {
  const units = atoms(text.trim().split(/\s+/));
  const bursts = [];
  let current = [];
  const join = () => current.join(" ");
  const flush = () => { if (current.length) { bursts.push(join()); current = []; } };
  // Hand back any trailing word that leans forward, so a burst does not end
  // on an article or a preposition. Returns how many were handed back.
  const handBack = () => {
    let given = 0;
    while (current.length > 2 && leansOn(current[current.length - 1])) {
      current.pop();
      given += 1;
    }
    return given;
  };

  for (let i = 0; i < units.length; i++) {
    current.push(units[i]);
    // A token that would push the burst past the line starts the next one.
    if (current.length > 1 && !fits(join())) {
      current.pop();
      i -= 1 + handBack();
      flush();
      continue;
    }
    if (i === units.length - 1) break;
    const chars = join().length;
    // The best place to stop is right after a clause or a sentence ends.
    if (closes(units[i]) && chars >= MIN_POP_CHARS) { flush(); continue; }
    if (words(join()) >= MAX_POP_WORDS || chars >= MAX_POP_CHARS) {
      // One more token is allowed past the caps when it closes the clause and
      // still fits, so "days," is not stranded at the head of the next burst.
      const next = units[i + 1];
      const withNext = join() + " " + next;
      if (closes(next) && fits(withNext) && withNext.length <= MAX_POP_CHARS + 8) continue;
      i -= handBack();
      flush();
    }
  }
  flush();

  // The slot is shared out by character count, so a short burst is also a
  // brief one; below about a dozen characters it flashes. It is merged into
  // whichever neighbour it belongs with, forward when it ends on a word that
  // leans on what comes next, backward otherwise, and every merge is measured.
  // When neither neighbour has room, the previous burst hands tokens over
  // from its end until this one stands on its own.
  for (let i = bursts.length - 1; i >= 0; i--) {
    if (bursts[i].length >= MIN_POP_CHARS && words(bursts[i]) >= 2) continue;
    const tail = bursts[i].split(" ").at(-1);
    const forward = leansOn(tail) && i + 1 < bursts.length;
    if (forward && fits(bursts[i] + " " + bursts[i + 1])) {
      bursts[i + 1] = bursts[i] + " " + bursts[i + 1];
      bursts.splice(i, 1);
      continue;
    }
    if (i > 0 && fits(bursts[i - 1] + " " + bursts[i])) {
      bursts[i - 1] = bursts[i - 1] + " " + bursts[i];
      bursts.splice(i, 1);
      continue;
    }
    if (i + 1 < bursts.length && fits(bursts[i] + " " + bursts[i + 1])) {
      bursts[i + 1] = bursts[i] + " " + bursts[i + 1];
      bursts.splice(i, 1);
      continue;
    }
    if (i > 0) {
      const prev = atoms(bursts[i - 1].split(" "));
      let mine = atoms(bursts[i].split(" "));
      while (prev.length > 1 && (mine.join(" ").length < MIN_POP_CHARS || words(mine.join(" ")) < 2 || leansOn(prev.at(-1)))) {
        mine = [prev.pop(), ...mine];
        if (!fits(mine.join(" "))) {
          prev.push(mine.shift());
          break;
        }
      }
      bursts[i - 1] = prev.join(" ");
      bursts[i] = mine.join(" ");
    }
  }

  // A single token wider than the line is folded onto two lines at the word
  // boundary that balances them best. Nothing else ever needs a second line.
  return bursts.map((burst) => {
    if (fits(burst)) return burst;
    const parts = burst.split(" ");
    let best = null;
    for (let k = 1; k < parts.length; k++) {
      const a = parts.slice(0, k).join(" ");
      const b = parts.slice(k).join(" ");
      if (!fits(a) || !fits(b)) continue;
      const gap = Math.abs(popWidth(a) - popWidth(b));
      if (best === null || gap < best.gap) best = { gap, text: a + "\\N" + b };
    }
    return best ? best.text : burst;
  });
}

/** The lines of these bursts that are still wider than the frame, as messages. */
export function oversized(bursts) {
  const out = [];
  for (const burst of bursts) {
    for (const line of burst.split("\\N")) {
      if (!fits(line)) out.push(`an English caption is ${Math.round(popWidth(line))}px wide and the line fits ${POP_LINE_PX}: "${line}"`);
    }
  }
  return out;
}
