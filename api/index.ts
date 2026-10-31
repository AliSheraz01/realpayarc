import { handleRequest } from '../server/index'

export const config = {
  maxDuration: 60,
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
}

export default async function handler(req: any, res?: any) {
  if (req.method === 'OPTIONS') {
    if (res && typeof res.status === 'function') {
      for (const [k, v] of Object.entries(CORS_HEADERS)) {
        res.setHeader(k, v)
      }
      return res.status(204).end()
    }
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  try {
    if (req instanceof Request || (req && typeof req.json === 'function' && !res)) {
      const response = await handleRequest(req)
      for (const [k, v] of Object.entries(CORS_HEADERS)) {
        response.headers.set(k, v)
      }
      return response
    }

    const host = req.headers?.['x-forwarded-host'] || req.headers?.host || 'localhost'
    const protocol = req.headers?.['x-forwarded-proto'] || 'https'
    const fullUrl = new URL(req.url || '/', `${protocol}://${host}`)

    let body: string | undefined
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (typeof req.body === 'string') {
        body = req.body
      } else if (req.body && typeof req.body === 'object') {
        body = JSON.stringify(req.body)
      } else if (req[Symbol.asyncIterator]) {
        const chunks: Buffer[] = []
        for await (const chunk of req) {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
        }
        body = Buffer.concat(chunks).toString('utf8')
      }
    }

    const headers = new Headers()
    if (req.headers) {
      for (const [key, value] of Object.entries(req.headers)) {
        if (value !== undefined) {
          headers.set(key, Array.isArray(value) ? value.join(', ') : String(value))
        }
      }
    }

    const webRequest = new Request(fullUrl.toString(), {
      method: req.method,
      headers,
      body: body ? body : undefined,
    })

    const webResponse = await handleRequest(webRequest)

    if (res && typeof res.status === 'function') {
      for (const [k, v] of Object.entries(CORS_HEADERS)) {
        res.setHeader(k, v)
      }
      webResponse.headers.forEach((val: string, key: string) => {
        res.setHeader(key, val)
      })
      const text = await webResponse.text()
      res.status(webResponse.status).send(text)
      return
    }

    return webResponse
  } catch (err: any) {
    console.error('[api/index] unhandled error:', err)
    const payload = {
      error: 'internal',
      message: err?.message || String(err),
      stack: err?.stack,
    }
    if (res && typeof res.status === 'function') {
      for (const [k, v] of Object.entries(CORS_HEADERS)) {
        res.setHeader(k, v)
      }
      return res.status(500).json(payload)
    }
    return new Response(JSON.stringify(payload), {
      status: 500,
      headers: { 'content-type': 'application/json', ...CORS_HEADERS },
    })
  }
}
