import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/news?q=서계동 재개발
 *
 * 구글 뉴스 RSS 를 그대로 읽어 제목·언론사·날짜·링크만 추린다.
 * 별도 키가 필요 없고, 본문을 저장하지 않으므로 저작권 문제도 없다.
 * (제목과 원문 링크만 보여주고 클릭하면 언론사로 보낸다)
 */

interface NewsItem {
  title: string
  source: string | null
  date: string | null
  link: string
}

const cache = new Map<string, { at: number; items: NewsItem[] }>()
const TTL = 30 * 60 * 1000

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))
  if (!m) return null
  return m[1]
    .replace(/^<!\[CDATA\[/, '')
    .replace(/\]\]>$/, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim()
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get('q')?.trim()
  if (!q) return NextResponse.json({ error: 'q 파라미터가 필요합니다.' }, { status: 400 })

  const hit = cache.get(q)
  if (hit && Date.now() - hit.at < TTL) {
    return NextResponse.json({ q, items: hit.items, cached: true })
  }

  try {
    const res = await fetch(
      `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ko&gl=KR&ceid=KR:ko`,
      { cache: 'no-store', headers: { 'User-Agent': 'Mozilla/5.0' } },
    )
    if (!res.ok) return NextResponse.json({ q, items: [], error: `RSS ${res.status}` })

    const xml = await res.text()
    const items: NewsItem[] = []

    for (const block of xml.match(/<item>[\s\S]*?<\/item>/g) ?? []) {
      const rawTitle = tag(block, 'title')
      const link = tag(block, 'link')
      if (!rawTitle || !link) continue

      const source = tag(block, 'source')
      // 구글 뉴스는 제목 끝에 " - 언론사"를 붙인다. 언론사를 따로 보여주므로 뗀다.
      const title = source ? rawTitle.replace(new RegExp(`\\s*-\\s*${source}\\s*$`), '') : rawTitle

      const pub = tag(block, 'pubDate')
      const t = pub ? Date.parse(pub) : NaN
      items.push({
        title,
        source,
        date: Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10),
        link,
      })
      if (items.length >= 12) break
    }

    cache.set(q, { at: Date.now(), items })
    return NextResponse.json({ q, items })
  } catch {
    return NextResponse.json({ q, items: [], error: 'FETCH_FAILED' })
  }
}
