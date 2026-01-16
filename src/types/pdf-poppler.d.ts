declare module 'pdf-poppler' {
  interface PdfOptions {
    format: string;
    out_dir: string;
    out_prefix: string;
    page?: number;
  }

  const pdf: {
    convert(pdfPath: string, options: PdfOptions): Promise<void>;
  };

  export default pdf;
}
