'use client';

import React, { useMemo, useState } from 'react';
import { Check, Copy, QrCode } from 'lucide-react';
import { generateQrCodeMatrix } from '@/lib/payments/qr-code';

export interface InlineQrCodeProps {
  value: string;
  size?: number;
  margin?: number;
  darkColor?: string;
  lightColor?: string;
  label?: string;
  className?: string;
}

/**
 * Zero-dependency inline vector QR code renderer backed by lib/payments/qr-code.ts.
 * Prints razor-sharp at any resolution (A5/A4 counter posters) with zero external packages.
 */
export function InlineQrCode({
  value,
  size = 200,
  margin = 2,
  darkColor = '#0f172a',
  lightColor = '#ffffff',
  label = 'Scan QR code',
  className = '',
}: InlineQrCodeProps) {
  const [copied, setCopied] = useState(false);

  const svgModel = useMemo(() => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const matrix = generateQrCodeMatrix(trimmed);
    if (!matrix) return null;
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
    return {
      totalSize,
      pathData: pathData.trim(),
    };
  }, [value, margin]);

  const handleCopyFallback = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard permission errors
    }
  };

  if (!svgModel) {
    return (
      <div
        className={`flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 p-4 text-center ${className}`}
        style={{ width: size, minHeight: size }}
      >
        <QrCode className="h-8 w-8 text-slate-400" />
        <p className="mt-2 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
          Direct Print Link
        </p>
        <p className="mt-1 break-all font-mono text-[10px] text-slate-500 dark:text-slate-400">
          {value}
        </p>
        <button
          type="button"
          onClick={() => void handleCopyFallback()}
          className="mt-2 inline-flex h-7 items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-600" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>Copy Link</span>
            </>
          )}
        </button>
      </div>
    );
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${svgModel.totalSize} ${svgModel.totalSize}`}
      shapeRendering="crispEdges"
      className={`block shrink-0 rounded-lg ${className}`}
    >
      <rect
        width={svgModel.totalSize}
        height={svgModel.totalSize}
        fill={lightColor}
      />
      <path d={svgModel.pathData} fill={darkColor} />
    </svg>
  );
}

export default InlineQrCode;
