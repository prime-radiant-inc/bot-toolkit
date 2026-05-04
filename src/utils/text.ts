// Text manipulation utilities

/**
 * Check if accumulated streaming text ends at a sentence boundary.
 * A boundary is punctuation (.!?) followed by whitespace, or a double newline.
 * The trailing whitespace requirement ensures we're past the boundary
 * (the next sentence has started streaming).
 */
export function endsAtSentenceBoundary(text: string): boolean {
  if (!text || text.length < 2) return false;
  if (/[.!?]\s+$/.test(text)) return true;
  if (text.endsWith('\n\n')) return true;
  return false;
}

/**
 * Extract first two non-empty lines from response text for use as
 * an announcement preview. Truncates to 300 chars if needed.
 */
export function getResponsePreview(text: string | null): string {
  if (!text) return '';
  const MAX_CHARS = 300;

  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0) return '';

  const preview = lines.slice(0, 2).join('\n');
  if (preview.length <= MAX_CHARS) return preview;
  return `${preview.slice(0, MAX_CHARS)}...`;
}

/**
 * Find the last sentence boundary in text within a max length.
 * Returns the index after the boundary (where to split), or maxLen if no boundary found.
 */
export function findLastSentenceBoundary(text: string, maxLen: number): number {
  if (text.length <= maxLen) return text.length;

  const searchRange = text.slice(0, maxLen);

  // Look for sentence-ending punctuation followed by space or end
  // Search from the end backwards for the last boundary
  for (let i = maxLen - 1; i >= Math.max(0, maxLen - 1000); i--) {
    const char = searchRange[i];
    const nextChar = searchRange[i + 1];

    // Sentence boundary: punctuation followed by space/newline or end of string
    if (
      (char === '.' || char === '!' || char === '?') &&
      (nextChar === ' ' ||
        nextChar === '\n' ||
        nextChar === undefined ||
        i === searchRange.length - 1)
    ) {
      return i + 1; // Include the punctuation
    }

    // Also split at newlines (paragraph boundaries)
    if (char === '\n' && nextChar === '\n') {
      return i + 1; // Split after the first newline
    }
  }

  // No good boundary found, just split at maxLen
  return maxLen;
}
