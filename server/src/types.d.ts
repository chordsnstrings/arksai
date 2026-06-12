declare module 'pdf-parse' {
  export class PDFParse {
    constructor(options: { data: Buffer | Uint8Array });
    getText(): Promise<{ text: string }>;
  }
}

declare module 'mammoth' {
  export function extractRawText(input: { path: string }): Promise<{ value: string }>;
}
