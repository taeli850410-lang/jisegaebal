# Supabase 붙이기

매물을 브라우저가 아니라 서버에 저장해 모두가 보게 하는 단계입니다.
키를 넣기 전까지는 앱이 지금처럼 브라우저 저장으로 동작합니다.

## 1. 프로젝트 만들기

<https://supabase.com> → New project.
리전은 **Northeast Asia (Seoul)** 을 고르세요 — 우리 Vercel 함수도 서울(icn1)이라
왕복이 짧습니다.

## 2. 테이블 만들기

대시보드 → **SQL Editor** → `schema.sql` 내용을 붙여넣고 Run.

## 3. 키 넣기

대시보드 → Project Settings → API 에서 두 값을 가져옵니다.

| 넣을 이름 | 어디서 |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` secret |

`.env.local` 에 넣고(이 파일은 git 에 안 올라갑니다), Vercel 프로젝트
환경변수에도 같은 이름으로 넣은 뒤 재배포하면 켜집니다.

> **`NEXT_PUBLIC_` 을 붙이지 마세요.** 그 접두사가 붙으면 브라우저 번들에
> 실려 누구나 우리 테이블을 두드릴 수 있습니다. 이 키는 서버 라우트에서만 씁니다.
> `anon` 키는 쓰지 않습니다 — RLS 를 켜 두었고 정책이 없어서 anon 으로는
> 아무것도 못 합니다.

## 4. 확인

```bash
curl -s "https://jisegaebal.vercel.app/api/listings" | head -c 200
```

- `{"unavailable":"NO_STORE"...}` → 아직 키가 안 들어갔습니다
- `{"items":[]...}` → 켜졌습니다

## 아직 안 한 것

**로그인이 없습니다.** 지금은 누구나 등록·삭제할 수 있습니다.
공개 서비스로 열기 전에 반드시 붙여야 합니다 —
`src/app/api/listings/route.ts` 의 POST·DELETE 에 소유자 검사를 넣는 자리를
주석으로 표시해 두었습니다.

공개 목록에 나오는 건 **중개사무소명·등록번호·전화가 갖춰진 매물만**입니다
(공인중개사법 제18조의2). 이 판단은 서버가 하고 클라이언트가 바꿀 수 없습니다.
