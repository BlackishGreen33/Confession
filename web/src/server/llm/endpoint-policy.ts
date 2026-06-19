import net from 'node:net';

const UNSAFE_ENDPOINT_OPT_IN = '1';

function unsafeEndpointAllowed(): boolean {
  return process.env.CONFESSION_ALLOW_UNSAFE_LLM_ENDPOINTS === UNSAFE_ENDPOINT_OPT_IN;
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '');
}

function isPrivateOrLoopbackIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map((part) => Number(part));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }

  const [first, second] = parts;
  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254) ||
    first === 0
  );
}

function isPrivateOrLoopbackIpv6(hostname: string): boolean {
  return (
    hostname === '::1' ||
    hostname === '0:0:0:0:0:0:0:1' ||
    hostname.startsWith('fc') ||
    hostname.startsWith('fd') ||
    hostname.startsWith('fe80:')
  );
}

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) {
    return true;
  }

  const ipVersion = net.isIP(normalized);
  if (ipVersion === 4) return isPrivateOrLoopbackIpv4(normalized);
  if (ipVersion === 6) return isPrivateOrLoopbackIpv6(normalized);
  return false;
}

export function normalizeAllowedLlmEndpoint(
  value: string | null | undefined
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('自訂 LLM endpoint 必須是有效 URL');
  }

  if (url.username || url.password) {
    throw new Error('自訂 LLM endpoint 不得包含認證資訊');
  }

  const allowUnsafeEndpoint = unsafeEndpointAllowed();
  if (!allowUnsafeEndpoint && url.protocol !== 'https:') {
    throw new Error('自訂 LLM endpoint 必須使用 https');
  }

  if (!allowUnsafeEndpoint && isPrivateOrLoopbackHost(url.hostname)) {
    throw new Error('自訂 LLM endpoint 不得指向 localhost 或 private IP');
  }

  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/+$/, '');
}
