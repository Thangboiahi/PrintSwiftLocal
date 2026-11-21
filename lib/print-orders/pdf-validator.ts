import { inflateSync } from 'zlib';
import {
  ALLOWED_PRINT_MIME_TYPES,
  MAX_PRINT_FILE_SIZE_BYTES,
  MAX_PRINT_PDF_PAGES,
  type AllowedPrintMimeType,
  type PrintFileValidationResult,
} from '@/lib/print-orders/types';

const ENCRYPTED_PDF_ERROR =
  'Password-protected PDFs cannot be printed automatically. Please unlock the PDF and upload again.';

function isAllowedPrintMimeType(value: string): value is AllowedPrintMimeType {
  return (ALLOWED_PRINT_MIME_TYPES as readonly string[]).includes(value);
}

function hasJpegMagicBytes(buf: Uint8Array): boolean {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

function hasPngMagicBytes(buf: Uint8Array): boolean {
  return (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  );
}

function hasWebpMagicBytes(buf: Uint8Array): boolean {
  return (
    buf.length >= 12 &&
    buf[0] === 0x52 && // R
    buf[1] === 0x49 && // I
    buf[2] === 0x46 && // F
    buf[3] === 0x46 && // F
    buf[8] === 0x57 && // W
    buf[9] === 0x45 && // E
    buf[10] === 0x42 && // B
    buf[11] === 0x50 // P
  );
}

function findPdfHeaderOffset(buf: Uint8Array): number {
  const maxScan = Math.min(buf.length - 5, 1024);
  for (let i = 0; i <= maxScan; i += 1) {
    if (
      buf[i] === 0x25 && // %
      buf[i + 1] === 0x50 && // P
      buf[i + 2] === 0x44 && // D
      buf[i + 3] === 0x46 && // F
      buf[i + 4] === 0x2d // -
    ) {
      return i;
    }
  }
  return -1;
}

function bytesToLatin1(buf: Uint8Array): string {
  // Fast chunked Latin-1 decoding (preserves 1:1 byte-to-char mapping with zero UTF-8 corruption)
  const CHUNK_SIZE = 32768;
  const parts: string[] = [];
  for (let offset = 0; offset < buf.length; offset += CHUNK_SIZE) {
    const slice = buf.subarray(offset, Math.min(offset + CHUNK_SIZE, buf.length));
    let chunk = '';
    for (let i = 0; i < slice.length; i += 1) {
      chunk += String.fromCharCode(slice[i]);
    }
    parts.push(chunk);
  }
  return parts.join('');
}

/**
 * Strips raw binary `stream ... endstream` payloads while preserving all PDF dictionaries,
 * trailers, xref tables, and object headers. Optionally captures `/ObjStm` FlateDecode streams
 * so PDF 1.5+ compressed object streams can also be inspected safely.
 */
function extractPdfStructureAndObjStreams(
  rawLatin1: string,
  rawBytes: Uint8Array
): {
  structuralText: string;
  inflatedObjStreamText: string;
} {
  const structuralParts: string[] = [];
  const inflatedParts: string[] = [];

  let cursor = 0;
  let inflatedObjStreamCount = 0;
  const MAX_OBJSTM_INFLATIONS = 64;
  const MAX_INFLATED_BYTES = 4 * 1024 * 1024;
  let totalInflatedBytes = 0;

  while (cursor < rawLatin1.length) {
    const streamIdx = rawLatin1.indexOf('stream', cursor);
    if (streamIdx === -1) {
      structuralParts.push(rawLatin1.slice(cursor));
      break;
    }

    // Ensure 'stream' is not part of 'endstream'
    const isEndstream =
      streamIdx >= 3 && rawLatin1.slice(streamIdx - 3, streamIdx) === 'end';
    if (isEndstream) {
      structuralParts.push(rawLatin1.slice(cursor, streamIdx + 6));
      cursor = streamIdx + 6;
      continue;
    }

    const dictWindowStart = Math.max(cursor, streamIdx - 512);
    const precedingDict = rawLatin1.slice(dictWindowStart, streamIdx);
    structuralParts.push(rawLatin1.slice(cursor, streamIdx));

    // Locate stream payload start (skip \r\n or \n right after 'stream')
    let dataStart = streamIdx + 6;
    if (rawLatin1[dataStart] === '\r' && rawLatin1[dataStart + 1] === '\n') {
      dataStart += 2;
    } else if (rawLatin1[dataStart] === '\n' || rawLatin1[dataStart] === '\r') {
      dataStart += 1;
    }

    const endStreamIdx = rawLatin1.indexOf('endstream', dataStart);
    if (endStreamIdx === -1) {
      // Unterminated stream; stop scanning stream bodies
      break;
    }

    // If this stream is a PDF 1.5+ Object Stream (/Type /ObjStm) or XRef stream with FlateDecode,
    // inflate its bytes so we can inspect compressed /Type /Pages and /Encrypt dictionaries
    const isObjStm =
      /\/Type\s*\/ObjStm\b/.test(precedingDict) &&
      /\/FlateDecode\b/.test(precedingDict);

    if (
      isObjStm &&
      inflatedObjStreamCount < MAX_OBJSTM_INFLATIONS &&
      totalInflatedBytes < MAX_INFLATED_BYTES
    ) {
      let dataEnd = endStreamIdx;
      while (
        dataEnd > dataStart &&
        (rawBytes[dataEnd - 1] === 0x0a || rawBytes[dataEnd - 1] === 0x0d)
      ) {
        dataEnd -= 1;
      }

      if (dataEnd > dataStart && dataEnd - dataStart <= 2 * 1024 * 1024) {
        try {
          const compressedSlice = rawBytes.subarray(dataStart, dataEnd);
          const inflated = inflateSync(compressedSlice, {
            maxOutputLength: 2 * 1024 * 1024,
          });
          totalInflatedBytes += inflated.byteLength;
          inflatedObjStreamCount += 1;
          inflatedParts.push(bytesToLatin1(inflated));
        } catch {
          // Ignore non-standard or partially filtered streams
        }
      }
    }

    structuralParts.push(' ');
    cursor = endStreamIdx + 'endstream'.length;
  }

  return {
    structuralText: structuralParts.join(''),
    inflatedObjStreamText: inflatedParts.join('\n'),
  };
}

function isPdfEncrypted(text: string): boolean {
  // Check standard PDF encryption markers in trailers, xref streams, and encryption dictionaries:
  //   /Encrypt 12 0 R   or   /Encrypt << ... >>   or   /Filter /Standard
  if (/\/Encrypt\s+\d+\s+\d+\s+R\b/.test(text)) {
    return true;
  }
  if (/\/Encrypt\s*<</.test(text)) {
    return true;
  }
  if (/\/Filter\s*\/Standard\b/.test(text) && /\/U\s*[\(<]/.test(text) && /\/O\s*[\(<]/.test(text)) {
    return true;
  }
  return false;
}

/**
 * Extracts `/Count N` values from `/Type /Pages` dictionaries and counts leaf `/Type /Page` entries.
 */
function extractPdfPageCount(text: string): {
  countFromPagesTree: number;
  leafPageCount: number;
  sawOverflowCount: boolean;
} {
  let maxPagesTreeCount = 0;
  let sawOverflowCount = false;

  // Match dictionaries containing `/Type /Pages` and `/Count N` in either order
  // (bounded to reasonable dictionary lengths without crossing nested unrelated objects)
  const objBlocks = text.split(/\bendobj\b/);

  for (const block of objBlocks) {
    if (!block.includes('/Pages')) continue;
    // Match `/Type /Pages` (ensuring it is not `/PagesSomething`)
    if (!/\/Type\s*\/Pages(?![A-Za-z0-9_])/.test(block)) continue;

    const countMatches = block.matchAll(/\/Count\s+(\d+)/g);
    for (const match of countMatches) {
      const parsed = Number.parseInt(match[1], 10);
      if (!Number.isFinite(parsed) || parsed <= 0) continue;
      if (parsed > MAX_PRINT_PDF_PAGES) {
        sawOverflowCount = true;
      }
      if (parsed > maxPagesTreeCount) {
        maxPagesTreeCount = parsed;
      }
    }
  }

  // Also scan inflated object stream text (which does not use `endobj` delimiters)
  const dictMatches = text.matchAll(/<<[^<>]{0,2000}>>/g);
  for (const dm of dictMatches) {
    const dict = dm[0];
    if (!/\/Type\s*\/Pages(?![A-Za-z0-9_])/.test(dict)) continue;
    const countMatch = dict.match(/\/Count\s+(\d+)/);
    if (countMatch) {
      const parsed = Number.parseInt(countMatch[1], 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        if (parsed > MAX_PRINT_PDF_PAGES) {
          sawOverflowCount = true;
        }
        if (parsed > maxPagesTreeCount) {
          maxPagesTreeCount = parsed;
        }
      }
    }
  }

  // Count leaf `/Type /Page` declarations (strictly excluding `/Pages`, `/PageMode`, `/PageLayout`, etc.)
  const leafMatches = text.match(/\/Type\s*\/Page(?![A-Za-z0-9_])/g);
  const leafPageCount = leafMatches ? leafMatches.length : 0;

  return {
    countFromPagesTree: maxPagesTreeCount,
    leafPageCount,
    sawOverflowCount,
  };
}

/**
 * Pure TypeScript, zero-external-dependency print file validator & page-count inspector.
 * Validates size ceiling (25 MB), MIME type, magic bytes, PDF encryption, and PDF page count (1..2000).
 */
export function validateAndInspectPrintFile(
  buffer: Uint8Array,
  mimeType: string
): PrintFileValidationResult {
  if (!buffer || buffer.byteLength === 0) {
    return {
      valid: false,
      error: 'Uploaded file is empty. Please choose a valid PDF or image.',
      code: 'EMPTY_FILE',
    };
  }

  if (buffer.byteLength > MAX_PRINT_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: 'File exceeds the 25 MB maximum upload limit per document.',
      code: 'FILE_TOO_LARGE',
    };
  }

  const normalizedMime = String(mimeType || '')
    .trim()
    .toLowerCase();

  if (!isAllowedPrintMimeType(normalizedMime)) {
    return {
      valid: false,
      error:
        'Unsupported file format. Only PDF, JPEG, PNG, and WebP files are accepted.',
      code: 'UNSUPPORTED_MIME_TYPE',
    };
  }

  // ---------------------------------------------------------------------------
  // Image Validation (Magic-Byte Verification -> 1 Page)
  // ---------------------------------------------------------------------------
  if (normalizedMime === 'image/jpeg') {
    if (!hasJpegMagicBytes(buffer)) {
      return {
        valid: false,
        error: 'Invalid JPEG file signature. The uploaded file appears corrupted.',
        code: 'INVALID_MAGIC_BYTES',
      };
    }
    return {
      valid: true,
      pageCount: 1,
      mimeType: 'image/jpeg',
      extension: 'jpg',
      byteSize: buffer.byteLength,
    };
  }

  if (normalizedMime === 'image/png') {
    if (!hasPngMagicBytes(buffer)) {
      return {
        valid: false,
        error: 'Invalid PNG file signature. The uploaded file appears corrupted.',
        code: 'INVALID_MAGIC_BYTES',
      };
    }
    return {
      valid: true,
      pageCount: 1,
      mimeType: 'image/png',
      extension: 'png',
      byteSize: buffer.byteLength,
    };
  }

  if (normalizedMime === 'image/webp') {
    if (!hasWebpMagicBytes(buffer)) {
      return {
        valid: false,
        error: 'Invalid WebP file signature. The uploaded file appears corrupted.',
        code: 'INVALID_MAGIC_BYTES',
      };
    }
    return {
      valid: true,
      pageCount: 1,
      mimeType: 'image/webp',
      extension: 'webp',
      byteSize: buffer.byteLength,
    };
  }

  // ---------------------------------------------------------------------------
  // PDF Validation (Header, Encryption Rejection & Page Count Extraction)
  // ---------------------------------------------------------------------------
  const pdfOffset = findPdfHeaderOffset(buffer);
  if (pdfOffset === -1) {
    return {
      valid: false,
      error: 'Invalid PDF header (%PDF- signature missing). Please upload a valid PDF.',
      code: 'INVALID_MAGIC_BYTES',
    };
  }

  const rawLatin1 = bytesToLatin1(buffer);
  const { structuralText, inflatedObjStreamText } =
    extractPdfStructureAndObjStreams(rawLatin1, buffer);
  const inspectableText = inflatedObjStreamText
    ? `${structuralText}\n${inflatedObjStreamText}`
    : structuralText;

  if (isPdfEncrypted(inspectableText)) {
    return {
      valid: false,
      error: ENCRYPTED_PDF_ERROR,
      code: 'PDF_ENCRYPTED',
    };
  }

  const { countFromPagesTree, leafPageCount, sawOverflowCount } =
    extractPdfPageCount(inspectableText);

  // Prefer the authoritative `/Type /Pages` `/Count N` tree root; fall back to leaf `/Type /Page` count
  const resolvedPageCount =
    countFromPagesTree > 0 ? countFromPagesTree : leafPageCount;

  if (sawOverflowCount || resolvedPageCount > MAX_PRINT_PDF_PAGES) {
    return {
      valid: false,
      error: `PDF exceeds the maximum supported limit of ${MAX_PRINT_PDF_PAGES.toLocaleString('en-IN')} pages per file.`,
      code: 'PDF_PAGE_LIMIT_EXCEEDED',
    };
  }

  if (resolvedPageCount < 1) {
    return {
      valid: false,
      error:
        'Could not detect any printable pages in this PDF. The file may be malformed or empty.',
      code: 'PDF_MALFORMED',
    };
  }

  return {
    valid: true,
    pageCount: resolvedPageCount,
    mimeType: 'application/pdf',
    extension: 'pdf',
    byteSize: buffer.byteLength,
  };
}
