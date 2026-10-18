import { describe, expect, it } from 'vitest';
import { documentText } from './document-text';
import { readFileSync } from 'node:fs';

function simplePdf() {
  const stream = 'BT /F1 12 Tf 20 100 Td (Alex Example - Software Engineer) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}
describe('local document text import', () => {
  it('extracts a Word CV locally', async () => {
    const bytes = readFileSync(new URL('./fixtures/cv.docx', import.meta.url));
    expect(await documentText('cv.docx', bytes)).toContain('Notice period: 2 weeks');
  });
  it('reads a real PDF locally without a model or external upload', async () => {
    expect(await documentText('cv.pdf', simplePdf())).toContain('Alex Example - Software Engineer');
  });
  it('reads text and rejects empty, unsupported or oversized files clearly', async () => {
    expect(
      await documentText('cv.txt', Buffer.from('Name: Alex\nNotice period: 2 weeks')),
    ).toContain('Notice period');
    await expect(documentText('cv.txt', Buffer.from(' '))).rejects.toThrow('No readable text');
    await expect(documentText('cv.exe', Buffer.from('content'))).rejects.toThrow('PDF, DOCX');
    await expect(documentText('cv.txt', Buffer.alloc(5 * 1024 * 1024 + 1))).rejects.toThrow('5 MB');
  });
});
