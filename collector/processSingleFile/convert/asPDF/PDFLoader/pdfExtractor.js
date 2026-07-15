const pdftotextExtractor = require("./extractors/pdftotextExtractor");
const pdfParseExtractor = require("./extractors/pdfParseExtractor");

const EXTRACTORS = [pdftotextExtractor, pdfParseExtractor];

const MIN_CHARS = parseInt(process.env.PDF_MIN_CHARS_FOR_OCR ?? "100", 10);
const QUALITY_THRESHOLD = parseFloat(process.env.PDF_QUALITY_THRESHOLD ?? "0.4");
function log(...args) {
  if (process.env.DEBUG_PDF === "true") console.log("[PDF]", ...args);
}

// ---------------------------------------------------------------------------
// Quality scoring
// ---------------------------------------------------------------------------

function computeQualityScore(pages) {
  const allText = pages.map((p) => p.text).join("\n");
  if (!allText.length) return 0;

  // printableRatio: ratio of printable / non-control chars
  const printable = (allText.match(/[\x20-\x7E -￿]/g) ?? []).length;
  const printableRatio = printable / allText.length;

  // wordDensity: words per 100 chars, normalised so ~12 words/100 = 1.0
  const words = allText.trim().split(/\s+/).filter(Boolean);
  const wordDensity = Math.min((words.length / allText.length) * 100 / 12, 1);

  // avgWordLength: penalise very short (<2) or very long (>20) avg
  const avgLen = words.reduce((s, w) => s + w.length, 0) / (words.length || 1);
  const avgWordLength = avgLen >= 2 && avgLen <= 20 ? 1 : 0.3;

  // structureScore — rewards preserved document layout
  const lines = allText.split("\n");
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  const total = lines.length || 1;
  const ne = nonEmpty.length || 1;

  // lineDensity: ~50 % non-empty lines is ideal prose-with-paragraphs
  const lineDensity = Math.min((ne / total) / 0.5, 1);

  // bulletScore: any line that starts with a bullet/numbering marker
  const bulletLines = nonEmpty.filter((l) =>
    /^\s*([•\-\*–]\s|\d+[.)]\s)/.test(l)
  ).length;
  const bulletScore = Math.min(bulletLines / ne / 0.1, 1);

  // headingScore: short lines that look like titles (ALL CAPS or Title Case)
  const headingLines = nonEmpty.filter((l) => {
    const t = l.trim();
    return (
      t.length >= 3 &&
      t.length <= 80 &&
      (t === t.toUpperCase() || /^[A-Z][a-z]/.test(t))
    );
  }).length;
  const headingScore = Math.min(headingLines / ne / 0.05, 1);

  // tableScore: lines with ≥ 2 multi-space runs (column alignment)
  const tableLines = lines.filter(
    (l) => (l.match(/[ \t]{2,}/g) ?? []).length >= 2
  ).length;
  const tableScore = Math.min(tableLines / total / 0.1, 1);

  const structureScore = (lineDensity + bulletScore + headingScore + tableScore) / 4;

  return (
    printableRatio * 0.25 +
    wordDensity * 0.20 +
    avgWordLength * 0.15 +
    structureScore * 0.40
  );
}

// ---------------------------------------------------------------------------
// Post-extraction text cleanup
// ---------------------------------------------------------------------------

function cleanPageText(text) {
  let out = text;

  // Strip inline running headers: "Chapter N TITLE...Page| NNN" concatenated
  // into surrounding content (no guaranteed line boundary).
  // Replaces the matched span with a newline so surrounding content stays on
  // separate lines.
  out = out.replace(
    /Chapter\s+\d+\s+[A-Z][A-Z0-9 \-\/()]{2,60}\s{2,}Page\s*\|?\s*\d+/g,
    "\n"
  );

  // Strip standalone "Page| NNN" or "Page NNN" lines
  out = out.replace(/^\s*Page\s*\|?\s*\d+\s*$/gm, "");

  // Collapse 3+ consecutive blank lines → 2
  out = out.replace(/(\r?\n){3,}/g, "\n\n");

  return out;
}

// ---------------------------------------------------------------------------
// Header / footer deduplication
// ---------------------------------------------------------------------------

function dedupeHeadersFooters(pages) {
  if (pages.length < 3) return pages;

  const threshold = Math.ceil(pages.length * 0.8);
  const freq = new Map();

  for (const { text } of pages) {
    const lines = text.split("\n");
    const candidates = [...lines.slice(0, 2), ...lines.slice(-2)];
    for (const line of candidates) {
      const t = line.trim();
      if (t.length > 3) freq.set(t, (freq.get(t) ?? 0) + 1);
    }
  }

  const toStrip = new Set(
    [...freq.entries()]
      .filter(([, count]) => count >= threshold)
      .map(([line]) => line)
  );

  if (toStrip.size === 0) return pages;

  return pages.map(({ pageNumber, text }) => ({
    pageNumber,
    text: text
      .split("\n")
      .filter((l) => !toStrip.has(l.trim()))
      .join("\n"),
  }));
}

// ---------------------------------------------------------------------------
// Main extraction entry point
// ---------------------------------------------------------------------------

async function extractPdfText(filePath, options = {}) {
  let best = null;

  for (const extractor of EXTRACTORS) {
    let result;

    try {
      result = await extractor.extract(filePath, options);
    } catch (err) {
      log(
        `method=${extractor.name} REJECTED reason=subprocess_error err="${err.message}"`
      );
      continue;
    }

    result.pages = result.pages.map((p) => ({
      ...p,
      text: cleanPageText(p.text),
    }));
    result.pages = dedupeHeadersFooters(result.pages);
    result.qualityScore = computeQualityScore(result.pages);
    result.charCount = result.pages.reduce((s, p) => s + p.text.length, 0);

    if (result.charCount < MIN_CHARS) {
      log(
        `method=${result.method} REJECTED reason=low_char_count(${result.charCount}<${MIN_CHARS})` +
          ` quality=${result.qualityScore.toFixed(2)} elapsed=${result.elapsedMs}ms`
      );
      if (!best || result.charCount > best.charCount) best = result;
      continue;
    }

    if (result.qualityScore < QUALITY_THRESHOLD) {
      log(
        `method=${result.method} REJECTED reason=low_quality(${result.qualityScore.toFixed(2)}<${QUALITY_THRESHOLD})` +
          ` chars=${result.charCount} elapsed=${result.elapsedMs}ms`
      );
      if (!best || result.qualityScore > best.qualityScore) best = result;
      continue;
    }

    log(
      `method=${result.method} chars=${result.charCount}` +
        ` quality=${result.qualityScore.toFixed(2)} elapsed=${result.elapsedMs}ms`
    );
    return result;
  }

  if (best) {
    log(
      `method=${best.method} ACCEPTED(best-available) chars=${best.charCount}` +
        ` quality=${best.qualityScore.toFixed(2)}`
    );
    return best;
  }

  return {
    pages: [],
    method: "none",
    charCount: 0,
    elapsedMs: 0,
    qualityScore: 0,
    pdfMeta: null,
  };
}

module.exports = { extractPdfText };
