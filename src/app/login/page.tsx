'use client'

import { useState } from 'react'

/**
 * 잠금 화면.
 *
 * 무엇을 지키는지 밝힌다 — 그냥 "비밀번호"만 물으면 왜 막혀 있는지 모른다.
 */
export default function Login() {
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      })
      if (r.ok) {
        const next = new URLSearchParams(window.location.search).get('next')
        window.location.href = next && next.startsWith('/') ? next : '/'
        return
      }
      setErr(((await r.json()) as { error?: string }).error ?? '들어갈 수 없습니다.')
    } catch {
      setErr('연결에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gray-50 px-5">
      <form onSubmit={submit} className="w-full max-w-sm">
        <div className="mb-5 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
            정
          </span>
          <h1 className="text-base font-bold text-gray-900">정비사업 정보 플랫폼</h1>
        </div>

        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] leading-relaxed text-amber-900">
          이 사이트에는 <b>매물 호가</b>가 들어 있어 비공개로 두었습니다. 중개대상물 광고는
          개업공인중개사만 할 수 있습니다(공인중개사법 제18조의2).
        </p>

        <label className="block">
          <span className="text-[11px] text-gray-500">비밀번호</span>
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoFocus
            className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-500"
          />
        </label>

        {err && <p className="mt-2 text-[11px] font-bold text-rose-600">{err}</p>}

        <button
          type="submit"
          disabled={busy || !pw}
          className="mt-3 w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? '확인 중…' : '들어가기'}
        </button>
      </form>
    </div>
  )
}
