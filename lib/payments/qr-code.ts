/**
 * PrintSwift Local - Zero-Dependency QR Code Generator
 *
 * Implements ISO/IEC 18004 QR Code Byte Mode (Versions 1–10, Error Correction L/M).
 * Generates an SVG string, data URL, or 2D boolean matrix with zero external dependencies.
 */

// GF(256) Math tables with primitive polynomial 0x11d (285)
const GF256_EXP = new Uint8Array(512);
const GF256_LOG = new Uint8Array(256);

(() => {
  let val = 1;
  for (let i = 0; i < 255; i++) {
    GF256_EXP[i] = val;
    GF256_EXP[i + 255] = val;
    GF256_LOG[val] = i;
    val = (val << 1) ^ (val & 0x80 ? 0x11d : 0);
  }
})();

function gfMultiply(x: number, y: number): number {
  if (x === 0 || y === 0) return 0;
  return GF256_EXP[GF256_LOG[x] + GF256_LOG[y]];
}

// Computes the Reed-Solomon generator polynomial for `degree` EC codewords
function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const factor = new Uint8Array([1, GF256_EXP[i]]);
    const nextPoly = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      nextPoly[j] ^= gfMultiply(poly[j], factor[0]);
      nextPoly[j + 1] ^= gfMultiply(poly[j], factor[1]);
    }
    poly = nextPoly;
  }
  return poly;
}

// Calculates Reed-Solomon error correction codewords for a data block
function rsCalculateEc(data: Uint8Array, ecCount: number): Uint8Array {
  const gen = rsGeneratorPoly(ecCount);
  const remainder = new Uint8Array(ecCount);

  for (let i = 0; i < data.length; i++) {
    const lead = data[i] ^ remainder[0];
    for (let j = 0; j < ecCount - 1; j++) {
      remainder[j] = remainder[j + 1] ^ gfMultiply(gen[j + 1], lead);
    }
    remainder[ecCount - 1] = gfMultiply(gen[ecCount], lead);
  }

  return remainder;
}

// Table of QR Code versions (Versions 1 to 10, Level L and Level M)
// format: [version, size, totalCodewords, ecCountPerBlock, blocks]
interface VersionConfig {
  version: number;
  size: number;
  totalCodewords: number;
  ecPerBlock: number;
  blockCount: number;
  alignmentPositions: number[];
}

const QR_CONFIGS_L: VersionConfig[] = [
  { version: 1, size: 21, totalCodewords: 26, ecPerBlock: 7, blockCount: 1, alignmentPositions: [] },
  { version: 2, size: 25, totalCodewords: 44, ecPerBlock: 10, blockCount: 1, alignmentPositions: [6, 18] },
  { version: 3, size: 29, totalCodewords: 70, ecPerBlock: 15, blockCount: 1, alignmentPositions: [6, 22] },
  { version: 4, size: 33, totalCodewords: 100, ecPerBlock: 20, blockCount: 1, alignmentPositions: [6, 26] },
  { version: 5, size: 37, totalCodewords: 134, ecPerBlock: 26, blockCount: 1, alignmentPositions: [6, 30] },
  { version: 6, size: 41, totalCodewords: 172, ecPerBlock: 18, blockCount: 2, alignmentPositions: [6, 34] },
  { version: 7, size: 45, totalCodewords: 196, ecPerBlock: 20, blockCount: 2, alignmentPositions: [6, 22, 38] },
  { version: 8, size: 49, totalCodewords: 242, ecPerBlock: 24, blockCount: 2, alignmentPositions: [6, 24, 42] },
  { version: 9, size: 53, totalCodewords: 292, ecPerBlock: 30, blockCount: 2, alignmentPositions: [6, 26, 46] },
  { version: 10, size: 57, totalCodewords: 346, ecPerBlock: 18, blockCount: 4, alignmentPositions: [6, 28, 50] },
];

const QR_CONFIGS_M: VersionConfig[] = [
  { version: 1, size: 21, totalCodewords: 26, ecPerBlock: 10, blockCount: 1, alignmentPositions: [] },
  { version: 2, size: 25, totalCodewords: 44, ecPerBlock: 16, blockCount: 1, alignmentPositions: [6, 18] },
  { version: 3, size: 29, totalCodewords: 70, ecPerBlock: 26, blockCount: 1, alignmentPositions: [6, 22] },
  { version: 4, size: 33, totalCodewords: 100, ecPerBlock: 18, blockCount: 2, alignmentPositions: [6, 26] },
  { version: 5, size: 37, totalCodewords: 134, ecPerBlock: 24, blockCount: 2, alignmentPositions: [6, 30] },
  { version: 6, size: 41, totalCodewords: 172, ecPerBlock: 16, blockCount: 4, alignmentPositions: [6, 34] },
  { version: 7, size: 45, totalCodewords: 196, ecPerBlock: 18, blockCount: 4, alignmentPositions: [6, 22, 38] },
  { version: 8, size: 49, totalCodewords: 242, ecPerBlock: 22, blockCount: 4, alignmentPositions: [6, 24, 42] },
  { version: 9, size: 53, totalCodewords: 292, ecPerBlock: 22, blockCount: 5, alignmentPositions: [6, 26, 46] },
  { version: 10, size: 57, totalCodewords: 346, ecPerBlock: 26, blockCount: 5, alignmentPositions: [6, 28, 50] },
];

// Encodes raw UTF-8 string into byte-mode QR codewords
function encodeByteData(text: string, dataCapacity: number): Uint8Array | null {
  const bytes = new TextEncoder().encode(text);
  // Byte mode header: 4 bits (0100) + 8 bits char count (for V1-9; 16 bits for V10-40, for V10 it is 16 bits)
  const isV10Plus = dataCapacity > 230;
  const countBits = isV10Plus ? 16 : 8;
  const totalBitsNeeded = 4 + countBits + bytes.length * 8;
  const maxBits = dataCapacity * 8;

  if (totalBitsNeeded > maxBits) {
    return null; // Exceeds capacity
  }

  const bitBuffer: number[] = [];
  const appendBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) {
      bitBuffer.push((val >> i) & 1);
    }
  };

  // Mode: 0100 (Byte mode)
  appendBits(0b0100, 4);
  appendBits(bytes.length, countBits);
  for (let i = 0; i < bytes.length; i++) {
    appendBits(bytes[i], 8);
  }

  // Terminator: up to 4 zero bits
  const termLength = Math.min(4, maxBits - bitBuffer.length);
  appendBits(0, termLength);

  // Pad to byte boundary
  while (bitBuffer.length % 8 !== 0) {
    bitBuffer.push(0);
  }

  // Pad bytes: alternating 0xEC (236) and 0x11 (17)
  let padByte = 0xec;
  while (bitBuffer.length < maxBits) {
    appendBits(padByte, 8);
    padByte = padByte === 0xec ? 0x11 : 0xec;
  }

  const dataCodewords = new Uint8Array(dataCapacity);
  for (let i = 0; i < dataCapacity; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) {
      b = (b << 1) | bitBuffer[i * 8 + j];
    }
    dataCodewords[i] = b;
  }

  return dataCodewords;
}

// Selects the smallest configuration that fits `byteLength`
function pickVersionConfig(byteLength: number, preferM = true): { config: VersionConfig; ecLevel: 'L' | 'M' } | null {
  const configs = preferM ? QR_CONFIGS_M : QR_CONFIGS_L;
  for (const cfg of configs) {
    const dataCodewords = cfg.totalCodewords - cfg.ecPerBlock * cfg.blockCount;
    const headerBytes = cfg.version >= 10 ? 3 : 2;
    if (byteLength <= dataCodewords - headerBytes) {
      return { config: cfg, ecLevel: preferM ? 'M' : 'L' };
    }
  }

  // Fallback to Level L if M is too tight
  if (preferM) {
    return pickVersionConfig(byteLength, false);
  }

  return null;
}

// Format info bits with BCH(15,5) code and mask XOR 0x5412
// EC level indicators: L = 01, M = 00
function getFormatBits(ecLevel: 'L' | 'M', mask: number): number {
  const ecBits = ecLevel === 'M' ? 0 : 1;
  const data = (ecBits << 3) | mask;
  let rem = data << 10;
  const gen = 0x537; // 10100110111
  for (let i = 14; i >= 10; i--) {
    if ((rem >> i) & 1) {
      rem ^= gen << (i - 10);
    }
  }
  return ((data << 10) | rem) ^ 0x5412;
}

/**
 * Generates a 2D matrix of booleans where true = black/dark module.
 */
export function generateQrCodeMatrix(text: string): boolean[][] | null {
  const textBytes = new TextEncoder().encode(text);
  const picked = pickVersionConfig(textBytes.length, true);
  if (!picked) return null;

  const { config, ecLevel } = picked;
  const { size, totalCodewords, ecPerBlock, blockCount } = config;
  const totalDataCodewords = totalCodewords - ecPerBlock * blockCount;

  const rawData = encodeByteData(text, totalDataCodewords);
  if (!rawData) return null;

  // Split data into blocks and compute EC per block
  const shortBlockDataLen = Math.floor(totalDataCodewords / blockCount);
  const longBlockCount = totalDataCodewords % blockCount;
  const shortBlockCount = blockCount - longBlockCount;

  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];

  let dataOffset = 0;
  for (let b = 0; b < blockCount; b++) {
    const bLen = b < shortBlockCount ? shortBlockDataLen : shortBlockDataLen + 1;
    const bData = rawData.slice(dataOffset, dataOffset + bLen);
    dataOffset += bLen;
    dataBlocks.push(bData);
    ecBlocks.push(rsCalculateEc(bData, ecPerBlock));
  }

  // Interleave data codewords, then EC codewords
  const finalCodewords = new Uint8Array(totalCodewords);
  let finalIdx = 0;

  // Interleave data
  const maxDataBlockLen = shortBlockDataLen + (longBlockCount > 0 ? 1 : 0);
  for (let i = 0; i < maxDataBlockLen; i++) {
    for (let b = 0; b < blockCount; b++) {
      if (i < dataBlocks[b].length) {
        finalCodewords[finalIdx++] = dataBlocks[b][i];
      }
    }
  }

  // Interleave EC
  for (let i = 0; i < ecPerBlock; i++) {
    for (let b = 0; b < blockCount; b++) {
      finalCodewords[finalIdx++] = ecBlocks[b][i];
    }
  }

  // Construct matrix
  // matrix: true = dark, false = light, null = unassigned
  const matrix: (boolean | null)[][] = Array.from({ length: size }, () =>
    Array(size).fill(null)
  );
  const isFunctionModule: boolean[][] = Array.from({ length: size }, () =>
    Array(size).fill(false)
  );

  const setModule = (r: number, c: number, dark: boolean, isFunc = true) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      matrix[r][c] = dark;
      if (isFunc) isFunctionModule[r][c] = true;
    }
  };

  // 1. Finder patterns (7x7) + separators at (0,0), (size-7, 0), (0, size-7)
  const drawFinder = (startR: number, startC: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const row = startR + r;
        const col = startC + c;
        if (row < 0 || row >= size || col < 0 || col >= size) continue;
        const inFinder = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        if (inFinder) {
          const isOuter = r === 0 || r === 6 || c === 0 || c === 6;
          const isCenter = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          setModule(row, col, isOuter || isCenter);
        } else {
          setModule(row, col, false); // Separator
        }
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(size - 7, 0);
  drawFinder(0, size - 7);

  // 2. Alignment patterns
  if (config.alignmentPositions.length > 0) {
    const pos = config.alignmentPositions;
    for (let i = 0; i < pos.length; i++) {
      for (let j = 0; j < pos.length; j++) {
        const r = pos[i];
        const c = pos[j];
        // Skip if inside finder areas
        const isFinderTL = r <= 8 && c <= 8;
        const isFinderTR = r <= 8 && c >= size - 9;
        const isFinderBL = r >= size - 9 && c <= 8;
        if (isFinderTL || isFinderTR || isFinderBL) continue;

        // Draw 5x5 alignment pattern
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const isBorder = Math.abs(dr) === 2 || Math.abs(dc) === 2;
            const isCenter = dr === 0 && dc === 0;
            setModule(r + dr, c + dc, isBorder || isCenter);
          }
        }
      }
    }
  }

  // 3. Timing patterns (alternating dark/light between finders at row 6 and col 6)
  for (let i = 8; i < size - 8; i++) {
    if (!isFunctionModule[6][i]) setModule(6, i, i % 2 === 0);
    if (!isFunctionModule[i][6]) setModule(i, 6, i % 2 === 0);
  }

  // 4. Dark module
  setModule(size - 8, 8, true);

  // 5. Reserve format information areas
  for (let i = 0; i < 9; i++) {
    if (!isFunctionModule[8][i]) isFunctionModule[8][i] = true;
    if (!isFunctionModule[i][8]) isFunctionModule[i][8] = true;
  }
  for (let i = size - 8; i < size; i++) {
    if (!isFunctionModule[8][i]) isFunctionModule[8][i] = true;
    if (!isFunctionModule[i][8]) isFunctionModule[i][8] = true;
  }

  // 6. Place data bits in zig-zag 2-column paths
  // Mask pattern 0: (row + col) % 2 === 0
  const maskFn = (r: number, c: number) => (r + c) % 2 === 0;

  let bitIdx = 0;
  const totalBits = totalCodewords * 8;

  let right = size - 1;
  let upward = true;

  while (right > 0) {
    if (right === 6) right--; // Skip vertical timing pattern column

    const rows = upward
      ? Array.from({ length: size }, (_, i) => size - 1 - i)
      : Array.from({ length: size }, (_, i) => i);

    for (const r of rows) {
      for (let c = right; c >= right - 1; c--) {
        if (!isFunctionModule[r][c]) {
          let bit = false;
          if (bitIdx < totalBits) {
            const byte = finalCodewords[Math.floor(bitIdx / 8)];
            const bitOffset = 7 - (bitIdx % 8);
            bit = ((byte >> bitOffset) & 1) === 1;
            bitIdx++;
          }

          // Apply mask
          const isMasked = maskFn(r, c);
          setModule(r, c, bit !== isMasked, false);
        }
      }
    }

    right -= 2;
    upward = !upward;
  }

  // 7. Write format information
  const formatBits = getFormatBits(ecLevel, 0); // Mask 0

  // Top-left format bits
  const tlCoords: [number, number][] = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],
    [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8],
    [2, 8], [1, 8], [0, 8],
  ];

  // Split format bits around corners
  const otherCoords: [number, number][] = [
    [size - 1, 8], [size - 2, 8], [size - 3, 8], [size - 4, 8],
    [size - 5, 8], [size - 6, 8], [size - 7, 8],
    [8, size - 8], [8, size - 7], [8, size - 6], [8, size - 5],
    [8, size - 4], [8, size - 3], [8, size - 2], [8, size - 1],
  ];

  for (let i = 0; i < 15; i++) {
    const bit = ((formatBits >> i) & 1) === 1;
    setModule(tlCoords[i][0], tlCoords[i][1], bit);
    setModule(otherCoords[i][0], otherCoords[i][1], bit);
  }

  return matrix.map((row) => row.map((cell) => cell === true));
}

export interface QrSvgOptions {
  size?: number;
  margin?: number;
  darkColor?: string;
  lightColor?: string;
}

/**
 * Generates an SVG string representation of the QR code.
 */
export function generateQrCodeSvg(text: string, options: QrSvgOptions = {}): string | null {
  const matrix = generateQrCodeMatrix(text);
  if (!matrix) return null;

  const margin = options.margin ?? 2;
  const darkColor = options.darkColor ?? '#0f172a';
  const lightColor = options.lightColor ?? '#ffffff';
  const matrixSize = matrix.length;
  const totalSize = matrixSize + margin * 2;

  let pathData = '';
  for (let r = 0; r < matrixSize; r++) {
    for (let c = 0; c < matrixSize; c++) {
      if (matrix[r][c]) {
        pathData += `M${c + margin},${r + margin}h1v1h-1z `;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalSize} ${totalSize}" shape-rendering="crispEdges">
  <rect width="${totalSize}" height="${totalSize}" fill="${lightColor}"/>
  <path d="${pathData.trim()}" fill="${darkColor}"/>
</svg>`;
}

/**
 * Generates an inline Data URL of the SVG QR Code.
 */
export function generateQrCodeDataUrl(text: string, options: QrSvgOptions = {}): string | null {
  const svg = generateQrCodeSvg(text, options);
  if (!svg) return null;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
