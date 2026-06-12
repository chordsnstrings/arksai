declare module 'pdf-parse/lib/pdf-parse.js' {
  function pdfParse(buffer: Buffer): Promise<{ text: string; numpages: number }>;
  export = pdfParse;
}

declare module 'mammoth' {
  export function extractRawText(input: { path: string }): Promise<{ value: string }>;
}
