const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function renderTemplate(value: unknown, params: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    return value.replace(PLACEHOLDER_PATTERN, (match, key) => {
      if (!(key in params)) {
        return match;
      }
      const replacement = params[key];
      return replacement === null || replacement === undefined ? '' : String(replacement);
    });
  }

  if (Array.isArray(value)) {
    return value.map((item) => renderTemplate(item, params));
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(([k, v]) => [
      renderTemplate(k, params),
      renderTemplate(v, params),
    ]);
    return Object.fromEntries(entries);
  }

  return value;
}
