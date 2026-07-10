/**
 * ELI5: One tiny door to the API, like NseHttpService is one door to NSE.
 * Every page imports these helpers instead of scattering fetch("http://...")
 * strings around — change the API address once, here.
 */
export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3000';

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status} from GET ${path}`);
  return res.json() as Promise<T>;
}

export async function apiSend<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${res.status} from ${method} ${path}: ${detail}`);
  }
  return res.json() as Promise<T>;
}
