// Stable per-browser identity, kept in localStorage so a player who reloads or
// drops can rejoin the same seat by opening the same link.

const TOKEN_KEY = 'vesper.token';
const NAME_KEY = 'vesper.name';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function randomId(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The secret token this browser uses to claim its seat. Never shown to other players. */
export function playerToken(): string {
  const s = storage();
  const existing = s?.getItem(TOKEN_KEY);
  if (existing && existing.length >= 16) return existing;
  const token = randomId();
  s?.setItem(TOKEN_KEY, token);
  return token;
}

export function savedName(): string {
  return storage()?.getItem(NAME_KEY) ?? '';
}

export function saveName(name: string): void {
  storage()?.setItem(NAME_KEY, name);
}
