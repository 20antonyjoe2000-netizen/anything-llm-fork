const { execFile } = require("child_process");

const pdftotextExtractor = {
  name: "pdftotext",

  extract(filePath, _options = {}) {
    const startTime = Date.now();
    return new Promise((resolve, reject) => {
      execFile(
        "pdftotext",
        ["-layout", "-enc", "UTF-8", filePath, "-"],
        { maxBuffer: 50 * 1024 * 1024 },
        (error, stdout) => {
          if (error) return reject(error);

          // pdftotext uses form-feed \f as page separator
          const rawPages = stdout.split("\f");
          const pages = [];
          for (let i = 0; i < rawPages.length; i++) {
            // pdftotext appends a trailing \f so the last split is always empty
            if (i === rawPages.length - 1 && rawPages[i].trim().length === 0)
              continue;
            pages.push({ pageNumber: i + 1, text: rawPages[i] });
          }

          resolve({
            pages,
            method: "pdftotext",
            charCount: pages.reduce((s, p) => s + p.text.length, 0),
            elapsedMs: Date.now() - startTime,
            qualityScore: 0, // filled in by pdfExtractor
            pdfMeta: null,
          });
        }
      );
    });
  },
};

module.exports = pdftotextExtractor;
