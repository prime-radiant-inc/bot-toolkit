/**
 * Sanitize user-controlled strings before injection into prompt context.
 * Strips XML-meaningful characters, control characters, and truncates.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — stripping C0 control characters from user input
const CONTROL_CHARS = /[\x00-\x1f]/g;

export function sanitizeForPrompt(input: string, maxLength = 80): string {
  return input
    .replace(/[<>]/g, '')
    .replace(CONTROL_CHARS, '')
    .slice(0, maxLength);
}
