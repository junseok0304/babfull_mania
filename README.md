<div align="center">
<img width="592" height="836" alt="밥풀매니아포스터" src="https://github.com/user-attachments/assets/d6dc5813-7f2d-4366-a6bc-7cc8ef7f9de1" />

# 밥풀매니아

### 오늘의 학식을 가장 쉽고 맛있게 확인하는 방법

성공회대학교 학식 메뉴를 식판 이미지와 예상 열량으로 한눈에 보여주는 반응형 웹 서비스입니다.

[**서비스 바로가기**](https://babfullmania.vercel.app/#home)

</div>

![밥풀매니아 메인 화면](asset/screenshots/home-main.png)

## 프로젝트 소개

밥풀매니아는 텍스트 위주의 학식표를 실제 식사 선택에 도움이 되는 화면으로 바꿉니다. 조식·중식 메뉴와 제공시간, 가격, 예상 열량을 함께 안내하고, 메뉴를 반영해 제작·검수한 식판 이미지로 한 끼의 구성을 직관적으로 보여줍니다.

식단 탐색뿐 아니라 공지·건의, 카카오톡 공유, 식단 및 이미지 운영, 이용 통계까지 하나의 서비스에서 관리할 수 있도록 구현했습니다.

## 주요 기능

- **오늘의 식단**: 조식·중식 메뉴, 제공시간, 가격과 예상 열량을 확인합니다.
- **식판 이미지**: 등록된 메뉴만 반영한 완성 식판 이미지 또는 메뉴별 대표 사진을 보여줍니다.
- **주간·월간 탐색**: 주 5일 식단과 월력형 과거 식단을 조회합니다.
- **메뉴 검색**: 과거 식단을 포함해 원하는 메뉴와 제공 날짜를 검색합니다.
- **카카오톡 공유**: 조식·중식 카드를 카카오톡 친구나 채팅방에 공유합니다.
- **공지·건의**: 운영 공지를 확인하고 공개 또는 비밀 건의사항을 작성합니다.
- **관리자 콘솔**: 식단, 제공 여부, 가격, 메뉴 사진, 공지, 사용자와 이용 기록을 관리합니다.
- **QR 정기권 실험 기능**: 개인 QR 인식과 이용 기록 흐름을 운영 테스트할 수 있습니다.

## 기술 구성

| 영역 | 사용 기술 |
| --- | --- |
| 사용자·관리자 화면 | HTML, CSS, Vanilla JavaScript |
| 데이터·인증·파일 | Supabase PostgreSQL, Auth, Storage, Edge Functions |
| 배포·서버리스 API | Vercel, Node.js API Functions |
| 카카오 기능 | Kakao Login, Share SDK, Memo API 검증 모듈 |
| 외부 데이터 | 식품안전나라·공공데이터포털 식품영양성분 데이터 |
| 품질 검증 | Node.js Test Runner, TypeScript |

## 로컬에서 실행하기

### 1. 준비물

- Git
- Node.js 20 이상과 npm
- Python 3(정적 개발 서버 실행용)

Supabase 계정 없이도 데모 모드로 주요 사용자·관리자 화면을 확인할 수 있습니다.

### 2. 저장소 복제

```bash
git clone https://github.com/junseok0304/babfull_mania.git
cd babfull_mania
```

### 3. 카카오 검증 모듈 의존성 설치

```bash
npm --prefix babfull-kakao-link ci
```

### 4. 개발 서버 실행

```bash
npm run dev
```

브라우저에서 다음 주소를 엽니다.

- 사용자 화면: `http://localhost:4173/?demo=1#home`
- 관리자 데모: `http://localhost:4173/admin/?demo=1`

`demo=1`은 외부 데이터베이스 없이 저장소의 시연 데이터로 UI와 주요 동작을 확인하는 모드입니다. 종료할 때는 실행 중인 터미널에서 `Ctrl+C`를 누릅니다.

> `npm run dev`는 Python 3의 정적 서버를 사용합니다. Windows에서 `python3` 명령을 찾지 못하면 저장소 루트에서 `py -m http.server 4173`을 실행할 수 있습니다.

## 환경변수와 외부 서비스 연결

실제 로그인, 데이터 저장, 식단 수집과 외부 API를 사용하려는 운영자만 아래 설정이 필요합니다. 데모 모드 이용자는 건너뛰어도 됩니다.

### 브라우저용 Supabase 공개 설정

```bash
cp js/config.example.json js/config.local.json
```

`js/config.local.json`에 본인의 Supabase 프로젝트 URL과 공개용 anon key를 입력합니다.

```json
{
  "supabaseUrl": "https://YOUR_PROJECT.supabase.co",
  "supabaseAnonKey": "YOUR_PUBLIC_ANON_KEY"
}
```

anon key는 브라우저 사용을 전제로 한 공개 키이지만, 데이터 보호는 반드시 Supabase RLS 정책으로 보장해야 합니다. service role key는 이 파일이나 프론트엔드 코드에 넣으면 안 됩니다.

### 서버·Edge Function 비밀값

```bash
cp .env.example .env
cp babfull-kakao-link/.env.example babfull-kakao-link/.env
```

각 예시 파일의 설명에 따라 본인이 발급받은 키를 입력합니다. `.env`, `js/config.local.json`, 토큰과 비밀번호는 Git 추적 대상에서 제외되어 있습니다. 외부 서비스의 Redirect URI와 웹 도메인도 자신의 로컬·배포 주소에 맞게 등록해야 합니다.

Supabase를 새로 구성하는 경우 `supabase/migrations/`을 시간순으로 적용하고, 필요한 Edge Function을 자신의 프로젝트에 배포해야 합니다. 운영 데이터나 기존 프로젝트에 적용하기 전에는 SQL과 RLS 정책을 반드시 검토하세요.

## 테스트

모든 웹 테스트, 카카오 모듈 테스트와 TypeScript 정적 검사를 한 번에 실행합니다.

```bash
npm run test:all
```

개별 실행도 가능합니다.

```bash
npm test                 # 사용자·관리자 화면 및 데이터 처리 테스트
npm run test:kakao      # 카카오 메시지 포맷·전송 어댑터 테스트
npm run typecheck       # 카카오 TypeScript 모듈 정적 검사
npm run test:assignment # 과제 캡처용 PASSED 배너 포함 테스트
```

현재 기준으로 웹 테스트 69개와 카카오 모듈 테스트 18개, 총 87개가 실행됩니다. 테스트는 실제 메시지 발송이나 운영 DB 변경 대신 Mock과 격리된 입력값을 사용합니다.

## 기본 사용법

### 일반 사용자

1. **오늘의 식단**에서 날짜를 이동해 조식·중식과 식판 이미지를 확인합니다.
2. **주간 식단**과 **월간 메뉴**에서 앞으로 또는 과거 식단을 탐색합니다.
3. **메뉴 검색**에서 음식명을 입력해 제공 이력을 찾습니다.
4. 식단 카드의 카카오 공유 버튼으로 원하는 대화를 선택합니다.
5. **공지·건의**에서 공지를 읽거나 로그인 후 건의사항을 작성합니다.

### 관리자 데모

`/admin/?demo=1`에서는 실제 운영 데이터를 변경하지 않고 관리 화면의 구조를 확인할 수 있습니다. 실제 관리 기능은 Supabase Auth 사용자에게 관리자 권한을 부여하고 RLS·관리자 정책을 적용한 환경에서만 사용해야 합니다.

## 프로젝트 구조

```text
.
├── index.html                 # 사용자 화면
├── admin/                     # 관리자 콘솔
├── css/                       # 반응형 사용자·관리자 스타일
├── js/                        # 화면, 데이터, 인증 및 공유 로직
├── api/                       # Vercel 서버리스 API
├── supabase/
│   ├── migrations/            # 테이블, RLS, RPC와 운영 데이터 마이그레이션
│   └── functions/             # 식단 수집·열량·이미지 Edge Functions
├── babfull-kakao-link/        # Node.js·TypeScript 카카오 검증 모듈
├── tests/                     # 웹 로직·접근제어·엣지케이스 테스트
├── scripts/                   # 운영·검증 보조 스크립트
└── asset/                     # 로고, 화면 캡처와 식판 이미지
```

## 데이터 흐름

1. 식단 원천 정보를 수집하거나 관리자가 식단을 등록합니다.
2. 메뉴명을 정규화해 Supabase에 날짜·식사 단위로 저장합니다.
3. 영양성분 데이터를 메뉴별 기준 제공량으로 환산해 예상 열량을 함께 저장합니다.
4. 관리자가 검수한 메뉴 사진 또는 완성 식판 이미지를 연결합니다.
5. 사용자 화면이 공개 식단, 이미지, 공지 데이터를 조회해 반응형 UI로 표시합니다.

## 운영 및 보안 유의사항

- 비밀키, OAuth 토큰, service role key를 코드나 커밋에 포함하지 마세요.
- 관리자 권한은 화면 숨김이 아니라 Supabase RLS와 서버 측 검증으로 제한해야 합니다.
- 식판 이미지는 메뉴 이해를 돕기 위한 참고 자료이며 실제 제공 모습과 다를 수 있습니다.
- 열량은 공공 식품영양성분 자료와 기준 배식량을 바탕으로 계산한 예상값입니다.
- QR 정기권 기능은 운영 실험 단계이므로 실제 결제·정산 시스템으로 간주하면 안 됩니다.
- 일반 단체 채팅방을 임의 지정해 자동 발송하는 기능은 카카오 공식 API에서 지원하지 않습니다. 서비스는 공식 공유창 방식을 사용합니다.

## 식단 정보 출처

학식 원천 정보는 학생 제보형 서비스 [영준.com](https://xn--vj5bw8c.com/babfullmenu)을 활용합니다.

밥풀매니아는 김학수 교수님의 **AI활용프로그래밍** 수업 산출물의 일환으로 제작되었습니다.
