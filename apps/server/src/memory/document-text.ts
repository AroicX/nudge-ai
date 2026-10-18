export async function documentText(filename: string, bytes: Buffer): Promise<string> {
  if (!bytes.length || bytes.length > 5 * 1024 * 1024)
    throw new Error('Choose a document smaller than 5 MB.');
  const extension = filename.toLowerCase().split('.').at(-1);
  let text: string;
  if (extension === 'txt' || extension === 'md') text = bytes.toString('utf8');
  else if (extension === 'docx') {
    const mammoth = await import('mammoth');
    text = (await mammoth.extractRawText({ buffer: bytes })).value;
  } else if (extension === 'pdf') {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loading = getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: false,
    });
    try {
      const pdf = await loading.promise;
      if (pdf.numPages > 30) throw new Error('Choose a PDF with at most 30 pages.');
      const pages: string[] = [];
      for (let page = 1; page <= pdf.numPages; page++) {
        const content = await (await pdf.getPage(page)).getTextContent();
        pages.push(content.items.flatMap((item) => ('str' in item ? [item.str] : [])).join(' '));
      }
      text = pages.join('\n\n');
    } finally {
      await loading.destroy();
    }
  } else throw new Error('Choose a PDF, DOCX, TXT or Markdown document.');
  text = text.replace(/\0/g, '').trim();
  if (!text)
    throw new Error(
      'No readable text was found. For a scanned document, upload a text-based copy or paste its text.',
    );
  if (text.length > 100000)
    throw new Error('This document contains too much text. Upload a shorter document.');
  return text;
}
