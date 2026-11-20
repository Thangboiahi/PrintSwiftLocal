import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateQrCodeMatrix,
  generateQrCodeSvg,
  generateQrCodeDataUrl,
} from './qr-code';

test('generateQrCodeMatrix produces valid square matrix for short UPI string', () => {
  const upi = 'upi://pay?pa=test@upi&pn=Test&am=100';
  const matrix = generateQrCodeMatrix(upi);
  assert.ok(matrix !== null, 'Matrix should not be null');
  assert.ok(Array.isArray(matrix), 'Matrix should be an array');
  assert.ok(matrix.length >= 21, 'Matrix should have at least 21 rows');
  assert.equal(matrix.length, matrix[0].length, 'Matrix should be square');
});

test('generateQrCodeMatrix handles full PrintSwift Local UPI URI', () => {
  const upi = 'upi://pay?pa=printswift@icici&pn=PrintSwift%20Local&am=450.00&cu=INR&tn=PSL-987654';
  const matrix = generateQrCodeMatrix(upi);
  assert.ok(matrix !== null);
  assert.ok(matrix.length >= 29);
  // Verify finder pattern at top-left: 7x7 outer border should be dark
  assert.equal(matrix[0][0], true);
  assert.equal(matrix[0][6], true);
  assert.equal(matrix[6][0], true);
  assert.equal(matrix[6][6], true);
});

test('generateQrCodeSvg produces valid SVG string with XML namespaces and rect/path', () => {
  const upi = 'upi://pay?pa=printswift@icici&pn=PrintSwift&am=10';
  const svg = generateQrCodeSvg(upi);
  assert.ok(svg !== null);
  assert.ok(svg.includes('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(svg.includes('<rect'));
  assert.ok(svg.includes('<path'));
});

test('generateQrCodeDataUrl produces valid data URI', () => {
  const upi = 'upi://pay?pa=printswift@icici&pn=PrintSwift&am=10';
  const dataUrl = generateQrCodeDataUrl(upi);
  assert.ok(dataUrl !== null);
  assert.ok(dataUrl.startsWith('data:image/svg+xml;utf8,'));
});
