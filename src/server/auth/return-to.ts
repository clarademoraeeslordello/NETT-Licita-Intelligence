/** Evita open redirect: só caminhos relativos da própria aplicação. */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || typeof value !== 'string') return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  if (/[\u0000-\u001f\u007f]/.test(value)) return '/';
  try {
    const u = new URL(value, 'http://interno.invalid');
    if (u.origin !== 'http://interno.invalid') return '/';
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return '/';
  }
}
