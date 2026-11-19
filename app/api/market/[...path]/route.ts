import { NextRequest, NextResponse } from 'next/server';

type Context = { params: Promise<{ path: string[] }> };

async function proxy(request: NextRequest, context: Context) {
  const base = process.env.MARKETPLACE_API_URL?.replace(/\/$/, '');
  if (!base) return NextResponse.json({ error: 'Marketplace API is not configured' }, { status: 503 });
  const { path } = await context.params;
  if (!path.length || path.some(part => part === '.' || part === '..')) return NextResponse.json({ error: 'Invalid API path' }, { status: 400 });
  const route = path.join('/');
  const allowed = (route === 'api/products' && request.method === 'GET')
    || (['api/auth/register', 'api/auth/verify', 'api/auth/login', 'api/auth/otp/request'].includes(route) && request.method === 'POST')
    || (route === 'api/account/me' && request.method === 'GET')
    || (route === 'api/seller/products' && ['GET', 'POST'].includes(request.method))
    || (route === 'api/seller/uploads' && request.method === 'POST')
    || (/^api\/seller\/products\/[0-9a-f-]{36}$/i.test(route) && ['PATCH', 'DELETE'].includes(request.method))
    || (route === 'api/orders' && ['GET', 'POST'].includes(request.method));
  if (!allowed) return NextResponse.json({ error: 'API route is not available through the storefront' }, { status: 404 });
  const url = new URL(`${base}/${path.map(encodeURIComponent).join('/')}`);
  request.nextUrl.searchParams.forEach((value, key) => url.searchParams.append(key, value));
  const headers = new Headers();
  for (const name of ['authorization', 'content-type', 'idempotency-key']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  try {
    const upstream = await fetch(url, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    });
    const responseHeaders = new Headers();
    const contentType = upstream.headers.get('content-type');
    if (contentType) responseHeaders.set('content-type', contentType);
    return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return NextResponse.json({ error: 'Marketplace API is unavailable' }, { status: 503 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
