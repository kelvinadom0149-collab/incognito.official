import { jwtVerify } from 'jose';

export type ReviewerSession = { sub: string; role: 'REVIEWER' | 'ADMIN' };

export async function requireReviewer(request: Request): Promise<ReviewerSession> {
  const authorization = request.headers.get('authorization');
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
  if (!token || !process.env.ADMIN_JWT_SECRET) throw new Error('UNAUTHORIZED');
  try {
    const secret = new TextEncoder().encode(process.env.ADMIN_JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    if (payload.role !== 'REVIEWER' && payload.role !== 'ADMIN') throw new Error('FORBIDDEN');
    return { sub: String(payload.sub), role: payload.role as 'REVIEWER' | 'ADMIN' };
  } catch {
    throw new Error('UNAUTHORIZED');
  }
}
