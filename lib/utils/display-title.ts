/**
 * DD oodle — Pass V4: Clean Display Title Helper
 * Strips leading `[SAMPLE]` tags from seeded demo titles so card headings stay
 * crisp and readable while callers can render a subtle `Sample` micro-badge.
 */

const SAMPLE_PREFIX_REGEX = /^\s*\[SAMPLE\]\s*/i;

export interface CleanDisplayTitle {
  title: string;
  isSample: boolean;
}

export function splitSamplePrefix(
  rawTitle: string | null | undefined
): CleanDisplayTitle {
  const input = (rawTitle || '').trim();
  if (!input) {
    return { title: '', isSample: false };
  }
  const isSample = SAMPLE_PREFIX_REGEX.test(input);
  const title = isSample ? input.replace(SAMPLE_PREFIX_REGEX, '').trim() : input;
  return { title: title || input, isSample };
}
