/**
 * 사이트 잠금에 쓰는 서명.
 *
 * 미들웨어(Edge)와 로그인 라우트(Node)가 함께 쓴다. 그래서 어느 쪽에도
 * 딸리지 않게 따로 뺐다 — 라우트가 미들웨어를 import 하면 그 파일이
 * 라우트 번들로 끌려 들어간다.
 *
 * Web Crypto 만 쓰므로 두 런타임에서 같이 돈다.
 */

export const COOKIE = 'jsg_pass'
/** 30일 */
export const MAX_AGE = 60 * 60 * 24 * 30

const enc = new TextEncoder()

/** 비밀번호를 그대로 쿠키에 담지 않는다 — 만료시각을 HMAC 으로 서명한 값만 오간다 */
export async function sign(secret: string, exp: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(String(exp)))
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${exp}.${hex}`
}

export async function valid(token: string | undefined, secret: string): Promise<boolean> {
  if (!token) return false
  const exp = Number(token.split('.')[0])
  if (!Number.isFinite(exp) || exp < Date.now()) return false
  // 앞에서부터 비교하지 않도록 다시 서명해 통째로 견준다
  return (await sign(secret, exp)) === token
}
