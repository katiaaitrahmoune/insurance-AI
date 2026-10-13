import fs from 'node:fs/promises';
import path from 'node:path';

/** Best-effort plain-text extraction from bytes (txt directly, PDF via pdf-parse). Returns '' on failure. */
export async function extractTextFromBuffer(buf, mimeType = '') {
  try {
    if (mimeType.startsWith('text/')) return buf.toString('utf8');
    if (mimeType === 'application/pdf') {
      const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
      return (await pdfParse(buf)).text || '';
    }
  } catch {
    /* fall through */
  }
  return '';
}

/** Same, from a file on disk (kept for scripts and tests). */
export async function extractText(filePath, mimeType = '') {
  const mime = mimeType || (path.extname(filePath).toLowerCase() === '.pdf' ? 'application/pdf' : 'text/plain');
  return extractTextFromBuffer(await fs.readFile(filePath), mime).catch(() => '');
}

/** Magic-byte check so a renamed binary cannot masquerade as a photo or PDF. */
export async function sniffFileType(filePath) {
  const fh = await fs.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(12);
    await fh.read(buf, 0, 12, 0);
    if (buf.subarray(0, 4).toString() === '%PDF') return 'application/pdf';
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    if (buf.subarray(1, 4).toString() === 'PNG') return 'image/png';
    if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
    return 'text/plain'; // accepted only for .txt reports; callers check the declared extension
  } finally {
    await fh.close();
  }
}
