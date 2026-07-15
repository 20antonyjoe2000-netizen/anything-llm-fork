const fs = require("fs").promises;

const pdfParseExtractor = {
  name: "pdf-parse",

  async extract(filePath, _options = {}) {
    const startTime = Date.now();
    const buffer = await fs.readFile(filePath);
    const { getDocument, version } = await getPdfJS();

    const pdf = await getDocument({
      data: new Uint8Array(buffer),
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;

    const meta = await pdf.getMetadata().catch(() => null);
    const pages = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();

      if (content.items.length === 0) {
        pages.push({ pageNumber: i, text: "" });
        continue;
      }

      let lastY;
      const textItems = [];
      for (const item of content.items) {
        if ("str" in item) {
          if (lastY === item.transform[5] || !lastY) {
            textItems.push(item.str);
          } else {
            textItems.push(`\n${item.str}`);
          }
          lastY = item.transform[5];
        }
      }

      pages.push({ pageNumber: i, text: textItems.join("").trim() });
    }

    return {
      pages,
      method: "pdf-parse",
      charCount: pages.reduce((s, p) => s + p.text.length, 0),
      elapsedMs: Date.now() - startTime,
      qualityScore: 0, // filled in by pdfExtractor
      pdfMeta: {
        version,
        info: meta?.info ?? null,
        metadata: meta?.metadata ?? null,
        totalPages: pdf.numPages,
      },
    };
  },
};

async function getPdfJS() {
  try {
    const pdfjs = await import(
      "pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js"
    );
    return { getDocument: pdfjs.getDocument, version: pdfjs.version };
  } catch {
    throw new Error(
      "Failed to load pdf-parse. Please install it with eg. `npm install pdf-parse`."
    );
  }
}

module.exports = pdfParseExtractor;
