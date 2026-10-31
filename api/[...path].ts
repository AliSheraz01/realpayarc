import { handleRequest } from '../server/index'

export const config = {
  maxDuration: 60,
}

export default async function handler(req: any, res?: any) {
  if (req instanceof Request || (req.url && req.headers && typeof req.json === 'function' && !res)) {
    return handleRequest(req)
  }

  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost'
  const protocol = req.headers['x-forwarded-proto'] || 'https'
  const fullUrl = new URL(req.url || '/', `${protocol}://${host}`)

  let body: string | undefined
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (typeof req.body === 'string') {
      body = req.body
    } else if (req.body && typeof req.body === 'object') {
      body = JSON.stringify(req.body)
    } else {
      const chunks: Buffer[] = []
      for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
      }
      body = Buffer.concat(chunks).toString('utf8')
    }
  }

  const webRequest = new Request(fullUrl.toString(), {
    method: req.method,
    headers: req.headers as any,
    body: body ? body : undefined,
  })

  const webResponse = await handleRequest(webRequest)

  res.status(webResponse.status)
  webResponse.headers.forEach((val: string, key: string) => {
    res.setHeader(key, val)
  })
  const text = await webResponse.text()
  res.end(text)
}
