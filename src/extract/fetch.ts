import dns from 'node:dns/promises';
import net from 'node:net';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_TEXT = 200_000;
const TIMEOUT_MS = 25_000;

export interface Source {
  url: string;
  kind: 'text' | 'pdf' | 'image';
  /** Page text (kind "text"), or the base64 bytes of a PDF or image (for example a service poster). */
  content: string;
  /** For images: image/jpeg, image/png, image/webp or image/gif. */
  mediaType?: string;
  /** True when the page was longer than we pass on; the reviewer is told. */
  truncated: boolean;
}

/** Addresses on this machine or a private network. The portal must never be used to read those. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

async function assertPublic(url: URL): Promise<void> {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('only http and https links can be read');
  if (url.username || url.password) throw new Error('links with sign-in details cannot be read');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new Error('that address is not a public website');
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Readable text of an HTML page: no scripts, styles or tags; block elements become line breaks. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(\w+);/g, (m, name) => ENTITIES[name] ?? m)
    .replace(/[ \t\f\r]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Downloads a public web page or PDF. Follows a few redirects, checking each hop, with size and time limits. */
export async function fetchSource(link: string, http: typeof fetch = fetch): Promise<Source> {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    throw new Error('that is not a valid link');
  }
  for (let hop = 0; hop < 5; hop++) {
    await assertPublic(url);
    const res = await http(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': 'policy-reference-reader/0.1', Accept: 'text/html,application/pdf,image/*,text/plain;q=0.8' },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location')!, url);
      continue;
    }
    if (!res.ok) throw new Error(`the website answered with an error (${res.status})`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_BYTES) throw new Error('that file is too large to read (over 8 MB)');
    const type = (res.headers.get('content-type') ?? '').toLowerCase();
    if (type.includes('pdf') || bytes.subarray(0, 5).toString('latin1') === '%PDF-') {
      return { url: url.href, kind: 'pdf', content: bytes.toString('base64'), truncated: false };
    }
    const image = /^image\/(jpeg|png|webp|gif)/.exec(type)?.[0];
    if (image) {
      if (bytes.length > 5 * 1024 * 1024) throw new Error('that image is too large to read (over 5 MB)');
      return { url: url.href, kind: 'image', content: bytes.toString('base64'), mediaType: image, truncated: false };
    }
    if (type && !/text|html|xml|json/.test(type)) throw new Error(`that link is not a web page, PDF or image (${type})`);
    const raw = bytes.toString('utf8');
    const text = /<html|<body|<div|<p\b/i.test(raw) ? htmlToText(raw) : raw.trim();
    if (text.length < 200) throw new Error('this page only shows its content inside a browser, so it cannot be read directly; save the page as a PDF or take a screenshot, and upload that as the source instead');
    return { url: url.href, kind: 'text', content: text.slice(0, MAX_TEXT), truncated: text.length > MAX_TEXT };
  }
  throw new Error('too many redirects');
}
