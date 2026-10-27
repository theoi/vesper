// Room codes avoid look-alike characters (0/O, 1/I/L) so they are easy to read aloud.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;

export function randomCode(length = CODE_LENGTH): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/** Uppercases and drops spaces and dashes; null if the result can't be a code. */
export function normalizeCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== CODE_LENGTH) return null;
  for (const ch of code) if (!ALPHABET.includes(ch)) return null;
  return code;
}

/**
 * Page parameters a share link keeps, so friends open the game the way the
 * host did: `?ui=` (which UI) and `?gfx=` (stage detail). Whatever the host's
 * page has goes along; a host on the default UI shares links without `ui`.
 */
export const LINK_PARAMS = ['ui', 'gfx'] as const;

/**
 * Shareable link for a room, e.g. https://theoi.github.io/vesper/?room=KX7QM.
 * `page` is the host's page URL; only its origin, path, and `LINK_PARAMS` carry over.
 */
export function roomLink(code: string, page: string = location.href): string {
  const from = new URL(page);
  const url = new URL(from.origin + from.pathname);
  url.searchParams.set('room', code);
  for (const key of LINK_PARAMS) {
    const value = from.searchParams.get(key);
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

/** Room code from `?room=` or `#room=` in a URL, if present and valid. */
export function roomFromUrl(href: string = location.href): string | null {
  const url = new URL(href);
  const raw = url.searchParams.get('room') ?? new URLSearchParams(url.hash.slice(1)).get('room');
  return raw ? normalizeCode(raw) : null;
}
