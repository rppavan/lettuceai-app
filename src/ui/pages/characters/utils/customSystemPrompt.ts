// UI-only sentinel for the prompt template <select>; never persisted.
export const CUSTOM_PROMPT_OPTION = "__custom__";

export const ORIGINAL_TOKEN = "{{original}}";

const TOKEN_PATTERN = /\{\{([^{}]+)\}\}/g;

/** Return {{tokens}} in content that are not known variables (and not {{original}}). */
export function findUnknownTokens(
  content: string,
  knownVariables: ReadonlySet<string>,
): string[] {
  const unknown = new Set<string>();
  for (const match of content.matchAll(TOKEN_PATTERN)) {
    const token = match[1].trim();
    if (token.toLowerCase() === "original") continue;
    if (knownVariables.has(token) || knownVariables.has(`{{${token}}}`)) continue;
    unknown.add(`{{${token}}}`);
  }
  return [...unknown];
}
