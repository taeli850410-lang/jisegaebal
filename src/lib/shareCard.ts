import { PROJECT_TYPE_MAP, STAGES, stageColor } from './taxonomy'

/**
 * 구역 공유 카드 이미지 생성.
 *
 * 카카오톡·블로그에 구역 하나를 공유할 때 링크만 던지면 아무것도 안 보인다.
 * 화면을 캡처하면 지도·패널이 같이 찍히고 글자가 뭉갠다.
 * 그래서 지금 화면의 실제 값으로 카드 한 장을 그려 PNG 로 내려받게 한다.
 *
 * 원칙 — 여기서 그리는 숫자는 전부 우리가 실제로 가진 값이다.
 * 조감도처럼 "있을 법한 그림"을 만들어 넣지 않는다. 진짜 조감도가 없는 구역에
 * 그럴듯한 건물 이미지를 얹으면 그게 계획안인 줄 읽힌다.
 * 값이 없는 칸은 비운다.
 */

export interface ShareCardInput {
  name: string
  projectType: string
  stage: string | null
  canonicalStage: string | null
  gu: string | null
  dong: string | null
  /** 경계 없는 사업장이면 면적을 아예 안 그린다 */
  areaM2: number | null
  households: number | null
  agingPct: number | null
  medianPerPyeong: number | null
  dealCount: number | null
  noticeDate: string | null
  /** 화면에 박을 출처 한 줄 */
  source: string
}

const W = 1200
const H = 630

/** 참고 앱과 같은 다크 스튜디오 톤 — 지도 UI 와 달리 카드는 어두운 쪽이 글자가 산다 */
const BG_TOP = '#0a1120'
const BG_MID = '#0f172a'
const BG_BOT = '#131f37'
const FG = '#e2e8f0'
const MUTED = '#94a3b8'
const LINE = 'rgba(148,163,184,0.16)'

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** 캔버스에는 말줄임이 없다. 폭에 맞춰 직접 자른다. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text
  let s = text
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1)
  return `${s}…`
}

function pill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  color: string,
  opts: { solid?: boolean } = {},
): number {
  ctx.font = '700 22px "Pretendard", "Malgun Gothic", system-ui, sans-serif'
  const padX = 16
  const w = ctx.measureText(text).width + padX * 2
  const h = 40
  roundRect(ctx, x, y, w, h, 20)
  if (opts.solid) {
    ctx.fillStyle = color
    ctx.fill()
    ctx.fillStyle = '#ffffff'
  } else {
    ctx.fillStyle = `${color}26` // 15% — 참고 앱의 blue-500/15 배지와 같은 결
    ctx.fill()
    ctx.strokeStyle = `${color}66`
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.fillStyle = color
  }
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + padX, y + h / 2 + 1)
  return w
}

/** 큰 숫자 한 칸. 값이 없으면 — 로 두고 색을 죽인다. */
function stat(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  label: string,
  value: string | null,
  unit?: string,
) {
  ctx.textBaseline = 'alphabetic'
  ctx.font = '600 20px "Pretendard", "Malgun Gothic", system-ui, sans-serif'
  ctx.fillStyle = MUTED
  ctx.fillText(label, x, y)

  if (value === null) {
    ctx.font = '800 40px "Pretendard", "Malgun Gothic", system-ui, sans-serif'
    ctx.fillStyle = 'rgba(148,163,184,0.45)'
    ctx.fillText('—', x, y + 48)
    return
  }
  ctx.font = '800 44px "Pretendard", "Malgun Gothic", system-ui, sans-serif'
  ctx.fillStyle = '#ffffff'
  ctx.fillText(fit(ctx, value, w - 40), x, y + 49)
  if (unit) {
    const vw = ctx.measureText(value).width
    ctx.font = '700 22px "Pretendard", "Malgun Gothic", system-ui, sans-serif'
    ctx.fillStyle = MUTED
    ctx.fillText(unit, x + vw + 6, y + 49)
  }
}

export function drawShareCard(z: ShareCardInput): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  // 2배로 그려야 카카오톡·블로그에서 축소·확대돼도 글자가 안 뭉갠다
  const scale = 2
  canvas.width = W * scale
  canvas.height = H * scale
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)

  const accent = stageColor(z.canonicalStage)
  const type = PROJECT_TYPE_MAP.get(z.projectType)

  /* ── 배경 ── */
  const g = ctx.createLinearGradient(0, 0, W, H)
  g.addColorStop(0, BG_TOP)
  g.addColorStop(0.55, BG_MID)
  g.addColorStop(1, BG_BOT)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)

  // 진행단계 색으로 오른쪽 위에 은은한 글로우 — 카드마다 색이 달라져 구분이 된다
  const glow = ctx.createRadialGradient(W - 60, 40, 0, W - 60, 40, 620)
  glow.addColorStop(0, `${accent}2E`)
  glow.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  /* ── 머리말 ── */
  const PAD = 64
  ctx.textBaseline = 'middle'
  roundRect(ctx, PAD, 48, 44, 44, 12)
  ctx.fillStyle = accent
  ctx.fill()
  ctx.font = '800 24px "Pretendard", "Malgun Gothic", system-ui, sans-serif'
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.fillText('정', PAD + 22, 71)
  ctx.textAlign = 'left'

  ctx.font = '800 24px "Pretendard", "Malgun Gothic", system-ui, sans-serif'
  ctx.fillStyle = FG
  ctx.fillText('정비사업 정보 플랫폼', PAD + 60, 71)

  ctx.font = '600 19px "Pretendard", "Malgun Gothic", system-ui, sans-serif'
  ctx.fillStyle = MUTED
  ctx.textAlign = 'right'
  ctx.fillText([z.gu, z.dong].filter(Boolean).join(' ') || '서울', W - PAD, 71)
  ctx.textAlign = 'left'

  /* ── 배지 ── */
  let bx = PAD
  if (type) bx += pill(ctx, bx, 132, type.label, accent) + 10
  if (z.stage) pill(ctx, bx, 132, z.stage, accent, { solid: true })

  /* ── 구역명 ── */
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#ffffff'
  const nameSize = z.name.length > 22 ? 46 : z.name.length > 16 ? 54 : 62
  ctx.font = `800 ${nameSize}px "Pretendard", "Malgun Gothic", system-ui, sans-serif`
  ctx.fillText(fit(ctx, z.name, W - PAD * 2), PAD, 248)

  /* ── 진행 막대 ──
     11단계 중 어디까지 왔는지. 단계를 모르면 아예 안 그린다. */
  const idx = STAGES.findIndex((s) => s.code === z.canonicalStage)
  if (idx >= 0) {
    const barY = 290
    const barW = W - PAD * 2
    roundRect(ctx, PAD, barY, barW, 8, 4)
    ctx.fillStyle = 'rgba(148,163,184,0.18)'
    ctx.fill()
    const done = ((idx + 1) / STAGES.length) * barW
    roundRect(ctx, PAD, barY, done, 8, 4)
    ctx.fillStyle = accent
    ctx.fill()

    ctx.font = '600 18px "Pretendard", "Malgun Gothic", system-ui, sans-serif'
    ctx.fillStyle = MUTED
    ctx.fillText(`${idx + 1} / ${STAGES.length} 단계`, PAD, barY + 38)
  }

  /* ── 수치 4칸 ── */
  const cols = 4
  const gap = 24
  const colW = (W - PAD * 2 - gap * (cols - 1)) / cols
  const sy = 396

  roundRect(ctx, PAD - 24, sy - 56, W - PAD * 2 + 48, 150, 20)
  ctx.fillStyle = 'rgba(15,25,46,0.66)'
  ctx.fill()
  ctx.strokeStyle = LINE
  ctx.lineWidth = 1
  ctx.stroke()

  const cells: [string, string | null, string?][] = [
    ['세대수', z.households ? z.households.toLocaleString() : null, '세대'],
    ['노후도', z.agingPct != null ? String(z.agingPct) : null, '%'],
    [
      '대지평당가',
      z.medianPerPyeong ? `${(z.medianPerPyeong / 10000).toFixed(0)}` : null,
      '만원',
    ],
    ['구역면적', z.areaM2 ? Math.round(z.areaM2 / 3.3058).toLocaleString() : null, '평'],
  ]
  cells.forEach(([label, value, unit], i) => {
    stat(ctx, PAD + i * (colW + gap), sy, colW, label, value, unit)
  })

  /* ── 꼬리말 — 출처는 반드시 남긴다 ── */
  ctx.font = '500 17px "Pretendard", "Malgun Gothic", system-ui, sans-serif'
  ctx.fillStyle = 'rgba(148,163,184,0.8)'
  ctx.fillText(fit(ctx, z.source, W - PAD * 2 - 220), PAD, H - 44)

  ctx.textAlign = 'right'
  ctx.fillStyle = MUTED
  ctx.font = '700 17px "Pretendard", "Malgun Gothic", system-ui, sans-serif'
  ctx.fillText('jisegaebal.vercel.app', W - PAD, H - 44)
  ctx.textAlign = 'left'

  return canvas
}

/** 카드를 파일로 내려받는다 */
export function downloadShareCard(z: ShareCardInput) {
  const canvas = drawShareCard(z)
  canvas.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${z.name.replace(/[\\/:*?"<>|]/g, '_')}_공유카드.png`
    a.click()
    // revoke 를 즉시 하면 브라우저가 저장을 시작하기 전에 사라진다
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }, 'image/png')
}
