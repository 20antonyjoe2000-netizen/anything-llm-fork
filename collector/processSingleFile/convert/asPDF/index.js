const { v4 } = require("uuid");
const {
  createdDate,
  trashFile,
  writeToServerDocuments,
} = require("../../../utils/files");
const { tokenizeString } = require("../../../utils/tokenizer");
const { default: slugify } = require("slugify");
const PDFLoader = require("./PDFLoader");
const OCRLoader = require("../../../utils/OCRLoader");

async function asPdf({
  fullFilePath = "",
  filename = "",
  options = {},
  metadata = {},
}) {
  const pdfLoader = new PDFLoader(fullFilePath, {
    splitPages: true,
  });

  console.log(`-- Working ${filename} --`);
  const pageContent = [];
  const textDocs = await pdfLoader.load();

  // Build per-page text map from direct extraction
  const textByPage = new Map();
  for (const doc of textDocs) {
    const pg = doc.metadata?.loc?.pageNumber;
    if (pg) textByPage.set(pg, doc.pageContent || "");
  }

  // Always run full-page OCR to capture screenshots and workflow diagrams
  const ocrLoader = new OCRLoader({ targetLanguages: options?.ocr?.langList });
  const ocrByPage = await ocrLoader.fullPageOCRPdf(fullFilePath);

  // Merge: prefer direct text extraction; fall back to OCR for screenshot-heavy pages
  const MIN_TEXT_CHARS = 100;
  // If OCR captured 150+ more chars than text extraction, it likely found
  // screenshot/UI content embedded as images — combine both to preserve all info
  const OCR_SCREENSHOT_BONUS = 150;
  const allPages = new Set([...textByPage.keys(), ...ocrByPage.keys()]);

  if (allPages.size > 0) {
    for (const pg of [...allPages].sort((a, b) => a - b)) {
      console.log(`-- Parsing content from pg ${pg} --`);
      const text = textByPage.get(pg) || "";
      const ocr = ocrByPage.get(pg) || "";
      const chosen = (() => {
        if (text.length >= MIN_TEXT_CHARS)
          return ocr.length > text.length + OCR_SCREENSHOT_BONUS
            ? text + "\n\n" + ocr
            : text;
        return ocr || text;
      })();
      if (chosen.trim().length > 0) pageContent.push(chosen);
    }
  }

  // Last-resort fallback for fully-scanned PDFs with no extractable images
  if (pageContent.length === 0 && textDocs.length === 0) {
    console.log(
      `[asPDF] No content after merge for ${filename}. Attempting embedded-image OCR.`
    );
    const fallbackDocs = await ocrLoader.ocrPDF(fullFilePath);
    for (const doc of fallbackDocs) {
      if (doc.pageContent?.length) pageContent.push(doc.pageContent);
    }
  }

  if (!pageContent.length) {
    console.error(`[asPDF] Resulting text content was empty for ${filename}.`);
    if (!options.absolutePath) trashFile(fullFilePath);
    return {
      success: false,
      reason: `No text content found in ${filename}.`,
      documents: [],
    };
  }

  const content = pageContent.join("");
  const data = {
    id: v4(),
    url: "file://" + fullFilePath,
    title: metadata.title || filename,
    docAuthor:
      metadata.docAuthor ||
      textDocs[0]?.metadata?.pdf?.info?.Creator ||
      "no author found",
    description:
      metadata.description ||
      textDocs[0]?.metadata?.pdf?.info?.Title ||
      "No description found.",
    docSource: metadata.docSource || "pdf file uploaded by the user.",
    chunkSource: metadata.chunkSource || "",
    published: createdDate(fullFilePath),
    wordCount: content.split(" ").length,
    pageContent: content,
    token_count_estimate: tokenizeString(content),
  };

  const document = writeToServerDocuments({
    data,
    filename: `${slugify(filename)}-${data.id}`,
    options: { parseOnly: options.parseOnly },
  });
  if (!options.absolutePath) trashFile(fullFilePath);
  console.log(`[SUCCESS]: ${filename} converted & ready for embedding.\n`);
  return { success: true, reason: null, documents: [document] };
}

module.exports = asPdf;
