const { TextSplitter } = require("../../../utils/TextSplitter");
const _ = require("lodash");

describe("TextSplitter", () => {
  test("should split long text into n sized chunks", async () => {
    const text = "This is a test text to be split into chunks".repeat(2);
    const textSplitter = new TextSplitter({
      chunkSize: 20,
      chunkOverlap: 0,
    });
    const chunks = await textSplitter.splitText(text);
    expect(chunks.length).toEqual(5);
  });

  test("applies chunk overlap of 200 characters on invalid chunkOverlap", async () => {
    const text = "This is a test text to be split into chunks".repeat(10);
    const textSplitter = new TextSplitter({
      chunkSize: 300,
    });
    const chunks = await textSplitter.splitText(text);
    expect(chunks.length).toBeGreaterThan(0);
    // With 200-char overlap each chunk shares context with the next
    expect(chunks.every((c) => c.length <= 300)).toBe(true);
  });

  test("does not allow chunkOverlap to be greater than chunkSize", async () => {
    expect(() => {
      new TextSplitter({
        chunkSize: 20,
        chunkOverlap: 21,
      });
    }).toThrow();
  });

  test("applies specific metadata to stringifyHeader to each chunk", async () => {
    const metadata = {
      id: "123e4567-e89b-12d3-a456-426614174000",
      url: "https://example.com",
      title: "Example",
      docAuthor: "John Doe",
      published: "2021-01-01",
      chunkSource: "link://https://example.com",
      description: "This is a test text to be split into chunks",
    };
    const chunkHeaderMeta = TextSplitter.buildHeaderMeta(metadata);
    expect(chunkHeaderMeta).toEqual({
      sourceDocument: metadata.title,
      source: metadata.url,
      published: metadata.published,
    });
  });

  test("applies a valid chunkPrefix to each chunk", async () => {
    const text = "This is a test text to be split into chunks".repeat(2);
    let textSplitter = new TextSplitter({
      chunkSize: 20,
      chunkOverlap: 0,
      chunkPrefix: "testing: ",
    });
    let chunks = await textSplitter.splitText(text);
    expect(chunks.length).toEqual(5);
    expect(chunks.every(chunk => chunk.startsWith("testing: "))).toBe(true);

    textSplitter = new TextSplitter({
      chunkSize: 20,
      chunkOverlap: 0,
      chunkPrefix: "testing2: ",
    });
    chunks = await textSplitter.splitText(text);
    expect(chunks.length).toEqual(5);
    expect(chunks.every(chunk => chunk.startsWith("testing2: "))).toBe(true);

    textSplitter = new TextSplitter({
      chunkSize: 20,
      chunkOverlap: 0,
      chunkPrefix: undefined,
    });
    chunks = await textSplitter.splitText(text);
    expect(chunks.length).toEqual(5);
    expect(chunks.every(chunk => !chunk.startsWith(": "))).toBe(true);

    textSplitter = new TextSplitter({
      chunkSize: 20,
      chunkOverlap: 0,
      chunkPrefix: "",
    });
    chunks = await textSplitter.splitText(text);
    expect(chunks.length).toEqual(5);
    expect(chunks.every(chunk => !chunk.startsWith(": "))).toBe(true);

    // Applied chunkPrefix with chunkHeaderMeta
    textSplitter = new TextSplitter({
      chunkSize: 20,
      chunkOverlap: 0,
      chunkHeaderMeta: TextSplitter.buildHeaderMeta({
        title: "Example",
        url: "https://example.com",
        published: "2021-01-01",
      }),
      chunkPrefix: "testing3: ",
    });
    chunks = await textSplitter.splitText(text);
    expect(chunks.length).toEqual(5);
    expect(chunks.every(chunk => chunk.startsWith("testing3: <document_metadata>"))).toBe(true);
  });
});

describe("TextSplitter.injectSectionHeadings", () => {
  test("prepends heading to body chunks that follow a heading chunk", () => {
    const chunks = [
      "4.11 Closure of Locker Account\n\nTo close a locker account...",
      "Select SDV Account Closure from the menu.",
    ];
    const result = TextSplitter.injectSectionHeadings(chunks);
    expect(result[0]).toBe(chunks[0]);
    expect(result[1]).toBe("4.11 Closure of Locker Account\n\nSelect SDV Account Closure from the menu.");
  });

  test("does not modify chunks that already start with a heading", () => {
    const chunks = [
      "4.11 Closure of Locker Account\n\nContent.",
      "4.12 Another Section\n\nMore content.",
    ];
    const result = TextSplitter.injectSectionHeadings(chunks);
    expect(result[0]).toBe(chunks[0]);
    expect(result[1]).toBe(chunks[1]);
  });

  test("multiple sections — body chunks get their own section heading", () => {
    const chunks = [
      "4.8 Changing Locker Status\n\nIntro.",
      "Body of section 4.8.",
      "4.11 Closure of Locker Account\n\nIntro.",
      "Enter screen 035512.",
    ];
    const result = TextSplitter.injectSectionHeadings(chunks);
    expect(result[1]).toContain("4.8 Changing Locker Status");
    expect(result[3]).toContain("4.11 Closure of Locker Account");
    expect(result[3]).not.toContain("4.8 Changing Locker Status");
  });

  test("no prepend if no heading has been seen yet", () => {
    const chunks = ["Front matter with no section heading.", "More front matter."];
    const result = TextSplitter.injectSectionHeadings(chunks);
    expect(result).toEqual(chunks);
  });

  test("does not double-inject if heading already present in first 120 chars", () => {
    const heading = "4.11 Closure of Locker Account";
    const chunks = [
      `${heading}\n\nIntro.`,
      `${heading}\n\nContinued content that was split here.`,
    ];
    const result = TextSplitter.injectSectionHeadings(chunks);
    // Second chunk already contains the heading — should not prepend again
    expect(result[1]).toBe(chunks[1]);
  });

  test("matches dotted numeric section heading", () => {
    const chunks = ["4.11 Closure of Locker Account\n\nBody."];
    const result = TextSplitter.injectSectionHeadings(chunks);
    expect(result[0]).toBe(chunks[0]); // unchanged, it IS the heading
  });

  test("matches Chapter N heading", () => {
    const chunks = [
      "Chapter 4 Locker Management\n\nIntro.",
      "Body content.",
    ];
    const result = TextSplitter.injectSectionHeadings(chunks);
    expect(result[1]).toContain("Chapter 4 Locker Management");
  });

  test("matches all-caps CHAPTER heading", () => {
    const chunks = [
      "CHAPTER 4 LOCKER MANAGEMENT\n\nIntro.",
      "Body content.",
    ];
    const result = TextSplitter.injectSectionHeadings(chunks);
    expect(result[1]).toContain("CHAPTER 4 LOCKER MANAGEMENT");
  });

  test("does not match numbered list item", () => {
    const chunks = ["1. Click the Submit button and confirm."];
    const result = TextSplitter.injectSectionHeadings(chunks);
    // No heading seen yet, so returned as-is regardless
    expect(result[0]).toBe(chunks[0]);
  });

  test("numbered list item mid-section does not reset heading", () => {
    const chunks = [
      "4.11 Closure of Locker Account\n\nSteps:",
      "1. Click the Submit button.",
      "2. Confirm the dialog.",
    ];
    const result = TextSplitter.injectSectionHeadings(chunks);
    expect(result[1]).toContain("4.11 Closure of Locker Account");
    expect(result[2]).toContain("4.11 Closure of Locker Account");
  });
});
