const { extractPdfText } = require("./pdfExtractor");

class PDFLoader {
  constructor(filePath, { splitPages = true } = {}) {
    this.filePath = filePath;
    this.splitPages = splitPages;
  }

  async load() {
    const { pages, method, pdfMeta } = await extractPdfText(this.filePath);

    const sharedPdf = {
      version: pdfMeta?.version ?? null,
      info: pdfMeta?.info ?? null,
      metadata: pdfMeta?.metadata ?? null,
      totalPages: pdfMeta?.totalPages ?? pages.length,
      extractionMethod: method,
    };

    const documents = pages
      .filter((p) => p.text.trim().length > 0)
      .map(({ pageNumber, text }) => ({
        pageContent: text.trim(),
        metadata: {
          source: this.filePath,
          pdf: sharedPdf,
          loc: { pageNumber },
        },
      }));

    if (this.splitPages) return documents;

    if (documents.length === 0) return [];

    const joined = documents
      .map((d, i) =>
        i === 0
          ? d.pageContent
          : `\n\n--- Page ${d.metadata.loc.pageNumber} ---\n\n${d.pageContent}`
      )
      .join("");

    return [
      {
        pageContent: joined,
        metadata: { source: this.filePath, pdf: sharedPdf },
      },
    ];
  }
}

module.exports = PDFLoader;
