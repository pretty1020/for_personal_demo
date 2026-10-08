import type { VercelRequest, VercelResponse } from '@vercel/node'

export function applyCors(req: VercelRequest, res: VercelResponse): void {
  const origin = req.headers.origin
  const allowed = process.env.ALLOWED_ORIGIN
  if (allowed && origin === allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  }
}

export function handleOptions(req: VercelRequest, res: VercelResponse): boolean {
  if (req.method === 'OPTIONS') {
    applyCors(req, res)
    res.status(204).end()
    return true
  }
  return false
}

export function json(res: VercelResponse, status: number, body: unknown): void {
  res.status(status).json(body)
}
