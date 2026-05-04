import { describe, expect, it } from 'vitest';
import {
  endsAtSentenceBoundary,
  findLastSentenceBoundary,
  getResponsePreview,
} from '../text.js';

describe('findLastSentenceBoundary', () => {
  it('should return text length when text is shorter than maxLen', () => {
    expect(findLastSentenceBoundary('hello', 100)).toBe(5);
  });

  it('should return text length when text is exactly maxLen', () => {
    expect(findLastSentenceBoundary('hello', 5)).toBe(5);
  });

  it('should split at period followed by space', () => {
    const text = 'First sentence. Second sentence that goes on.';
    // maxLen=20 falls in "Second se..."
    // Search backward from 20 for boundary
    // "First sentence. " <- period at index 14, followed by space at 15
    const result = findLastSentenceBoundary(text, 20);
    expect(result).toBe(15); // After the period
    expect(text.slice(0, result)).toBe('First sentence.');
  });

  it('should split at exclamation mark followed by space', () => {
    const text = 'Wow! That is amazing! Another sentence.';
    const result = findLastSentenceBoundary(text, 25);
    // "Wow! That is amazing! " <- ! at index 20, space at 21
    expect(result).toBe(21);
    expect(text.slice(0, result)).toBe('Wow! That is amazing!');
  });

  it('should split at question mark followed by space', () => {
    const text = 'How are you? I am fine.';
    const result = findLastSentenceBoundary(text, 15);
    // "How are you? " <- ? at index 11, space at 12
    expect(result).toBe(12);
    expect(text.slice(0, result)).toBe('How are you?');
  });

  it('should split at period followed by newline', () => {
    const text = 'First sentence.\nSecond sentence.';
    const result = findLastSentenceBoundary(text, 20);
    // Period at index 14, newline at 15
    expect(result).toBe(15);
    expect(text.slice(0, result)).toBe('First sentence.');
  });

  it('should split at double newline (paragraph boundary)', () => {
    const text = 'Paragraph one\n\nParagraph two is longer';
    const result = findLastSentenceBoundary(text, 20);
    // \n at index 13, \n at index 14
    expect(result).toBe(14); // After the first \n
    expect(text.slice(0, result)).toBe('Paragraph one\n');
  });

  it('should prefer later boundary over earlier one', () => {
    const text = 'A. B. C. D. Keep going and going beyond limit.';
    const result = findLastSentenceBoundary(text, 15);
    // Search backward from 15: "A. B. C. D. Kee"
    // D. at index 9 (period), space at 10
    // C. at index 6, space at 7
    // B. at index 3, space at 4
    // Should find D. as it's the latest boundary before maxLen
    expect(result).toBe(11);
    expect(text.slice(0, result)).toBe('A. B. C. D.');
  });

  it('should return maxLen when no sentence boundary found', () => {
    const text = 'a'.repeat(2000);
    const result = findLastSentenceBoundary(text, 100);
    expect(result).toBe(100);
  });

  it('should handle period at end of search range', () => {
    const text = `Short. ${'x'.repeat(100)}`;
    const result = findLastSentenceBoundary(text, 7);
    // Period at index 5, space at 6
    expect(result).toBe(6);
    expect(text.slice(0, result)).toBe('Short.');
  });

  it('should not split at period without following space or newline', () => {
    // e.g. "file.txt" or "3.14" - period is not a sentence boundary
    const text = 'Check file.txt for details and more text here';
    const result = findLastSentenceBoundary(text, 15);
    // "Check file.txt " - period at index 10, 't' at 11 - not a boundary
    // No valid boundary in search range
    expect(result).toBe(15); // Falls back to maxLen
  });

  it('should search backward up to 1000 chars from maxLen', () => {
    // Create text with boundary just within search range
    const padding = 'x'.repeat(500);
    const text = `Start. ${padding} more text that goes on and on`;
    const maxLen = 510;
    // Period at index 5, space at 6 — within 1000 chars of maxLen
    const result = findLastSentenceBoundary(text, maxLen);
    expect(result).toBe(6);
  });

  it('should not search more than 1000 chars back from maxLen', () => {
    // Create text with boundary outside search range
    const padding = 'x'.repeat(1100);
    const text = `Start. ${padding}`;
    const maxLen = text.length - 1;
    // Period at index 5 — more than 1000 chars before maxLen
    // Search starts at Math.max(0, maxLen - 1000)
    const result = findLastSentenceBoundary(text, maxLen);
    // Should NOT find the period since it's too far back
    expect(result).toBe(maxLen);
  });

  it('should handle empty text', () => {
    expect(findLastSentenceBoundary('', 100)).toBe(0);
  });

  it('should handle maxLen of 0', () => {
    expect(findLastSentenceBoundary('hello.', 0)).toBe(0);
  });

  it('should handle text that is one character', () => {
    expect(findLastSentenceBoundary('.', 100)).toBe(1);
  });

  it('should handle period at very end of text within maxLen', () => {
    const text = 'Hello world.';
    expect(findLastSentenceBoundary(text, 100)).toBe(12);
  });
});

describe('endsAtSentenceBoundary', () => {
  it('returns false for empty string', () => {
    expect(endsAtSentenceBoundary('')).toBe(false);
  });

  it('returns false for single character', () => {
    expect(endsAtSentenceBoundary('a')).toBe(false);
  });

  it('returns true for period followed by space at end', () => {
    expect(endsAtSentenceBoundary('Hello world. ')).toBe(true);
  });

  it('returns true for exclamation followed by space at end', () => {
    expect(endsAtSentenceBoundary('Wow! ')).toBe(true);
  });

  it('returns true for question mark followed by space at end', () => {
    expect(endsAtSentenceBoundary('How are you? ')).toBe(true);
  });

  it('returns true for punctuation followed by multiple spaces', () => {
    expect(endsAtSentenceBoundary('Done.  ')).toBe(true);
  });

  it('returns false for period without trailing whitespace', () => {
    expect(endsAtSentenceBoundary('Hello world.')).toBe(false);
  });

  it('returns false for text ending mid-word', () => {
    expect(endsAtSentenceBoundary('Hello wor')).toBe(false);
  });

  it('returns false for text ending mid-sentence', () => {
    expect(endsAtSentenceBoundary('Hello world, this is')).toBe(false);
  });

  it('returns true for double newline at end', () => {
    expect(endsAtSentenceBoundary('Paragraph one\n\n')).toBe(true);
  });

  it('returns false for single newline at end', () => {
    expect(endsAtSentenceBoundary('Hello world\n')).toBe(false);
  });

  it('returns true for period followed by newline and space', () => {
    expect(endsAtSentenceBoundary('Done.\n ')).toBe(true);
  });

  it('returns false for period in middle of text', () => {
    expect(endsAtSentenceBoundary('file.txt is here')).toBe(false);
  });
});

describe('getResponsePreview', () => {
  it('returns full text when short and single line', () => {
    expect(getResponsePreview('Hello world')).toBe('Hello world');
  });

  it('returns first two non-empty lines of multi-line text', () => {
    const text = 'Line one\nLine two\nLine three\nLine four';
    expect(getResponsePreview(text)).toBe('Line one\nLine two');
  });

  it('skips leading empty lines', () => {
    const text = '\n\nActual first line\nSecond line\nThird';
    expect(getResponsePreview(text)).toBe('Actual first line\nSecond line');
  });

  it('returns single line if only one non-empty line', () => {
    expect(getResponsePreview('Just one line\n\n\n')).toBe('Just one line');
  });

  it('returns empty string for empty input', () => {
    expect(getResponsePreview('')).toBe('');
  });

  it('returns empty string for null input', () => {
    expect(getResponsePreview(null)).toBe('');
  });

  it('truncates long lines', () => {
    const longLine = 'x'.repeat(400);
    const result = getResponsePreview(longLine);
    expect(result.length).toBeLessThanOrEqual(303); // 300 + '...'
  });

  it('handles markdown headers as lines', () => {
    const text =
      '# Good morning!\n\nHere is your daily briefing.\n\nMore details...';
    expect(getResponsePreview(text)).toBe(
      '# Good morning!\nHere is your daily briefing.',
    );
  });
});
