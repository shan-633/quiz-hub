/** getRandomValues is also available on ordinary LAN HTTP pages. */
export function randomId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((n) => n.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export async function drawingFingerprint(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  if (crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)]
      .slice(0, 10)
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('');
  }
  // Only a deterministic upload retry key; never used for authentication.
  let hash = 0xcbf29ce484222325n;
  for (const b of bytes) hash = BigInt.asUintN(64, (hash ^ BigInt(b)) * 0x100000001b3n);
  return hash.toString(16).padStart(16, '0');
}
