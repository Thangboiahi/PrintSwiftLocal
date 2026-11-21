/**
 * DD oodle — Pure-Browser Photo-to-PDF Stitcher & Bandwidth Compressor
 *
 * Zero external dependencies. Compresses camera/gallery photos (JPEG/PNG/WebP)
 * on an offscreen HTML5 Canvas (max 1600px on longest edge, JPEG quality 0.82)
 * and assembles a standards-compliant %PDF-1.4 binary with A4-proportioned pages,
 * /Filter /DCTDecode image XObjects, accurate xref byte offsets, and /Type /Pages /Count N.
 */

const MAX_EDGE_PX = 1600;
const JPEG_QUALITY = 0.82;
const A4_WIDTH_PT = 595.28;
const A4_HEIGHT_PT = 841.89;
const PAGE_MARGIN_PT = 24;

interface CompressedPageImage {
  jpegBytes: Uint8Array;
  widthPx: number;
  heightPx: number;
}

function encodeAscii(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    bytes[i] = text.charCodeAt(i) & 0xff;
  }
  return bytes;
}

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(
        new Error(
          `Could not decode image "${file.name}". Please pick a valid JPEG, PNG, or WebP photo.`
        )
      );
    };
    img.src = objectUrl;
  });
}

async function compressImageToJpeg(file: File): Promise<CompressedPageImage> {
  const img = await loadImageElement(file);
  const naturalW = img.naturalWidth || img.width;
  const naturalH = img.naturalHeight || img.height;

  if (!naturalW || !naturalH) {
    throw new Error(`Image "${file.name}" has invalid dimensions.`);
  }

  const longest = Math.max(naturalW, naturalH);
  const scale = longest > MAX_EDGE_PX ? MAX_EDGE_PX / longest : 1;
  const targetW = Math.max(1, Math.round(naturalW * scale));
  const targetH = Math.max(1, Math.round(naturalH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Browser canvas context is unavailable for photo compression.');
  }

  // Paint solid white background so transparent PNG/WebP images print cleanly
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, targetW, targetH);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, targetW, targetH);

  const jpegBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob && blob.size > 0) {
          resolve(blob);
        } else {
          reject(new Error(`Failed to compress photo "${file.name}" to JPEG.`));
        }
      },
      'image/jpeg',
      JPEG_QUALITY
    );
  });

  // Release canvas backing store promptly on mobile devices
  canvas.width = 1;
  canvas.height = 1;

  const buffer = await jpegBlob.arrayBuffer();
  return {
    jpegBytes: new Uint8Array(buffer),
    widthPx: targetW,
    heightPx: targetH,
  };
}

function concatByteChunks(chunks: Uint8Array[]): Uint8Array {
  let totalLength = 0;
  for (const c of chunks) {
    totalLength += c.byteLength;
  }
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return merged;
}

/**
 * Compresses one or more browser image File objects and stitches them into
 * a single multi-page A4 %PDF-1.4 File ready for upload.
 */
export async function convertImagesToPdfFile(
  files: File[],
  outputName = 'photos-document.pdf'
): Promise<File> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('Photo-to-PDF conversion requires a browser environment.');
  }

  const imageFiles = files.filter((f) => f && f.size > 0);
  if (imageFiles.length === 0) {
    throw new Error('Select at least one photo to convert into a PDF.');
  }

  const compressedPages: CompressedPageImage[] = [];
  for (const file of imageFiles) {
    compressedPages.push(await compressImageToJpeg(file));
  }

  const pageCount = compressedPages.length;
  // Object layout:
  //   1: Catalog
  //   2: Pages tree (/Count N)
  //   For page i (0..N-1):
  //     3 + i*3: Image XObject (/DCTDecode)
  //     4 + i*3: Page Content Stream
  //     5 + i*3: Page Dictionary (/Type /Page)
  const totalObjects = 2 + pageCount * 3;
  const offsets: number[] = new Array(totalObjects + 1).fill(0);
  const chunks: Uint8Array[] = [];
  let byteOffset = 0;

  const pushChunk = (bytes: Uint8Array) => {
    chunks.push(bytes);
    byteOffset += bytes.byteLength;
  };

  const pushAscii = (text: string) => {
    pushChunk(encodeAscii(text));
  };

  // PDF 1.4 Header + binary marker comment
  pushChunk(
    new Uint8Array([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, // %PDF-1.4\n
      0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a, // binary comment
    ])
  );

  // 1 0 obj — Catalog
  offsets[1] = byteOffset;
  pushAscii('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // 2 0 obj — Pages Root
  const kidsRefs = compressedPages
    .map((_, idx) => `${5 + idx * 3} 0 R`)
    .join(' ');
  offsets[2] = byteOffset;
  pushAscii(
    `2 0 obj\n<< /Type /Pages /Kids [${kidsRefs}] /Count ${pageCount} >>\nendobj\n`
  );

  // Per-page XObject, Content Stream, and Page Dictionary
  for (let i = 0; i < pageCount; i += 1) {
    const page = compressedPages[i];
    const imgObjId = 3 + i * 3;
    const contentObjId = 4 + i * 3;
    const pageObjId = 5 + i * 3;
    const imgName = `Im${i + 1}`;

    // Use landscape A4 if the photo is noticeably wider than tall, else portrait A4
    const isLandscape = page.widthPx > page.heightPx * 1.15;
    const pageW = isLandscape ? A4_HEIGHT_PT : A4_WIDTH_PT;
    const pageH = isLandscape ? A4_WIDTH_PT : A4_HEIGHT_PT;
    const maxDrawW = pageW - PAGE_MARGIN_PT * 2;
    const maxDrawH = pageH - PAGE_MARGIN_PT * 2;

    const fitScale = Math.min(
      maxDrawW / page.widthPx,
      maxDrawH / page.heightPx
    );
    const drawW = page.widthPx * fitScale;
    const drawH = page.heightPx * fitScale;
    const offsetX = (pageW - drawW) / 2;
    const offsetY = (pageH - drawH) / 2;

    // Image XObject
    offsets[imgObjId] = byteOffset;
    pushAscii(
      `${imgObjId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.widthPx} /Height ${page.heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpegBytes.byteLength} >>\nstream\n`
    );
    pushChunk(page.jpegBytes);
    pushAscii('\nendstream\nendobj\n');

    // Content Stream
    const contentCmd = `q\n${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${offsetX.toFixed(2)} ${offsetY.toFixed(2)} cm\n/${imgName} Do\nQ\n`;
    const contentBytes = encodeAscii(contentCmd);
    offsets[contentObjId] = byteOffset;
    pushAscii(
      `${contentObjId} 0 obj\n<< /Length ${contentBytes.byteLength} >>\nstream\n`
    );
    pushChunk(contentBytes);
    pushAscii('endstream\nendobj\n');

    // Page Object
    offsets[pageObjId] = byteOffset;
    pushAscii(
      `${pageObjId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW.toFixed(2)} ${pageH.toFixed(2)}] /Resources << /ProcSet [/PDF /ImageC] /XObject << /${imgName} ${imgObjId} 0 R >> >> /Contents ${contentObjId} 0 R >>\nendobj\n`
    );
  }

  // Accurate Byte-Offset XRef Table
  const xrefOffset = byteOffset;
  let xrefText = `xref\n0 ${totalObjects + 1}\n0000000000 65535 f \n`;
  for (let objNum = 1; objNum <= totalObjects; objNum += 1) {
    xrefText += `${String(offsets[objNum]).padStart(10, '0')} 00000 n \n`;
  }
  pushAscii(xrefText);

  // Trailer & EOF
  pushAscii(
    `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  );

  const finalBytes = concatByteChunks(chunks);
  const safeName = outputName.toLowerCase().endsWith('.pdf')
    ? outputName
    : `${outputName}.pdf`;

  const arrayBuffer = finalBytes.buffer.slice(
    finalBytes.byteOffset,
    finalBytes.byteOffset + finalBytes.byteLength
  ) as ArrayBuffer;

  return new File([arrayBuffer], safeName, {
    type: 'application/pdf',
    lastModified: Date.now(),
  });
}
