---
name: babfull-weekly-trays
description: 밥풀매니아에 등록된 주간 조식·중식 메뉴로 흰색 식판 이미지를 사전 생성하고 검수한 뒤 Supabase에 연결한다. 메뉴별 검색 사진이나 실시간 이미지 생성에는 사용하지 않는다.
---

# 밥풀매니아 주간 식판 이미지 생성 스킬

이 문서는 밥풀매니아의 **식단 수집 → 이미지 사전 생성 → 검수 → 업로드 → 사용자 화면 표시** 과정을 재현하기 위한 프로젝트용 스킬이다. 사용자 요청이 발생할 때마다 이미지를 생성하지 않고, 운영 전에 로컬 작업 환경에서 식사별 이미지를 한 번 생성해 정적 파일로 올린다.

<!--
모델 선택 주석:
실제 운영 이미지 제작에서는 생성 성능, 메뉴 준수 정확도, 시각적 품질과 검수 편의성을 고려해 GitHub Copilot의 이미지 생성 도구를 선택했다.
이 과정은 GitHub Copilot에 종속된 방식이 아니며, 동일한 SKILL.md와 프롬프트를 해석하고 이미지 생성 도구를 호출할 수 있는 다른 에이전트 환경에서도 수행할 수 있다.
다만 어떤 에이전트를 사용하든 아래의 메뉴 일치 검수와 업로드 전 확인 절차는 생략하지 않는다.
-->

## 모델과 도구 선택

- 본 프로젝트에서는 메뉴 누락·임의 음식 추가를 줄이고 일정한 구도를 얻기 위해 **GitHub Copilot 모델과 ImageGen 도구**를 사용했다.
- 동일한 지침과 프롬프트를 사용하면 **다른 에이전트 에서도 구현·생성 작업을 수행할 수 있다.** 단, 사용하는 Copilot 환경에 실제 이미지 생성 기능 또는 연결된 이미지 생성 도구가 있어야 한다.
- 모델 종류와 관계없이 생성 결과를 자동으로 신뢰하지 않는다. 등록된 메뉴와 결과 이미지를 사람이 항목별로 대조한 뒤에만 업로드한다.

## 이 방식을 선택한 이유

실서비스 요청마다 이미지 생성 API를 호출하면 같은 식단에도 비용과 대기 시간이 반복해서 발생한다.
밥풀매니아는 다음 방식으로 이를 방지한다.

1. 한 주의 확정 식단을 먼저 데이터베이스에 저장한다.
2. 운영 전에 로컬 작업 환경에서 식사별 이미지를 한 번만 생성한다.
3. 검수에 통과한 파일만 Supabase Storage에 업로드한다.
4. 사용자 화면은 생성 API를 호출하지 않고 저장된 공개 이미지 URL을 반복 사용한다.

따라서 페이지 조회 수가 늘어도 이미지 생성 API 비용은 증가하지 않는다. 재생성은 메뉴가 변경되었거나 검수에 실패한 식사에만 제한한다.

## 전체 데이터 흐름

```text
영준.com 주간 식단
  → Supabase Edge Function(import-yeongjun-menu)
  → yeongjun-parser로 날짜·조식·중식·휴무 파싱
  → meals / meal_items 저장
  → 대상 주차의 운영 식단 manifest 작성
  → 로컬에서 식사별 식판 이미지 생성·검수
  → Supabase Storage 업로드
  → meal_tray_images에 식단과 공개 URL 연결
  → 사용자 홈의 식판 사진 모드에서 정적 이미지 표시
```

### 1. 식단 정보 가져오기

- `supabase/functions/import-yeongjun-menu/index.ts`가 허용된 영준.com 식단 페이지를 가져온다.
- `supabase/functions/_shared/yeongjun-parser.js`가 월요일부터 금요일까지의 날짜와 조식·중식 항목을 분리한다.
- `*`, 숫자만 있는 셀, 운영시간 안내처럼 음식이 아닌 값은 제외한다.
- 휴무·미운영·미제공·연휴 문구는 음식으로 그리지 않고 운영 상태로 저장한다.
- 파싱 결과는 `import_yeongjun_meals` RPC를 통해 `meals`와 `meal_items`에 반영한다.
- 이미지 생성 시에는 웹페이지를 다시 임의 해석하지 않고, **Supabase에 최종 등록된 메뉴 목록을 기준 원본**으로 사용한다.

### 2. 생성 대상 manifest 만들기

대상 주차의 `meals`에서 다음 조건을 모두 만족하는 식사만 선택한다.

- 월요일부터 금요일 사이의 조식 또는 중식
- `is_published = true`
- `is_operating = true`
- `meal_items`가 한 개 이상 존재

휴무일, 미제공 식사, 빈 식단은 생성 대상에서 제외한다. 생성 전에 아래와 같이 날짜·식사·메뉴를 확정한다.

```text
2026-11-04 breakfast
- 백미밥
- 미역국
- 오징어덮밥
- 연두부&양념장
- 배추김치
- 바나나
```

이 목록은 이미지에 등장할 수 있는 음식의 완전한 목록이다. 목록에 없는 음료, 과일, 소스, 장식용 채소를 임의로 추가하지 않는다.

### 3. 로컬에서 이미지 생성하기

각 식사를 하나의 독립된 이미지로 생성한다. 한 이미지에 여러 날짜나 조식·중식을 합치지 않는다.

필수 구도는 다음과 같다.

- 사실적인 대학 식당 배식 사진
- 정면이 아닌 **수직 탑뷰**
- 화면 안에 전체가 보이는 **흰색 칸막이 식판**
- 밝고 중립적인 바닥, 부드러운 자연광
- 4:3 가로 비율
- 사람, 손, 포장지, 로고, 워터마크, 읽을 수 있는 글자 제외
- 등록 메뉴는 각각 한 번씩만 표현하고 누락·중복·대체 음식 금지

프롬프트 기본형:

```text
Use case: photorealistic-natural
Asset type: Babfull Mania fixed meal-tray image
Subject: exactly these registered items, each served once: <확정 메뉴 목록>
Composition: straight top-down, centered full white compartment cafeteria tray,
4:3 landscape, neutral light tabletop
Lighting: soft natural studio daylight, realistic university cafeteria portions
Constraints: every listed item visible exactly once; no missing, duplicate,
substituted, or extra food; no beverage unless explicitly listed; no people,
hands, packaging, utensils, text, logo, or watermark
```

파일은 프로젝트 안의 다음 위치에 저장한다.

```text
asset/generated-meal-trays/<해당 주 월요일>/YYYY-MM-DD-breakfast-v1.png
asset/generated-meal-trays/<해당 주 월요일>/YYYY-MM-DD-lunch-v1.png
```

이 단계가 여기서 말하는 “로컬 생성”이다. 운영 브라우저나 Vercel 함수가 이미지를 생성하는 것이 아니라, 개발 환경에서 결과 파일을 먼저 완성한다.

### 4. 업로드 전 시각 검수

각 결과물을 다음 순서로 직접 확인한다.

1. manifest의 모든 메뉴가 정확히 한 번씩 보이는가?
2. 등록되지 않은 음료·반찬·소스·과일이 추가되지 않았는가?
3. 흰색 식판, 수직 탑뷰, 전체 식판 노출, 4:3 구도가 지켜졌는가?
4. 음식이 다른 메뉴로 바뀌거나 한 메뉴가 중복되지 않았는가?
5. 사람·손·문자·로고·워터마크가 없는가?

하나라도 어긋나면 업로드하지 않고 잘못된 항목만 명시해 다시 생성한다. 두 번의 교정 후에도 정확하지 않으면 해당 식사는 미등록 상태로 남기고 원인을 기록한다.

### 5. Supabase에 연결하기

검수에 통과한 파일만 업로드 manifest로 만든다.

```json
[
  {
    "meal_date": "2026-11-04",
    "meal_type": "breakfast",
    "file_path": "/absolute/path/to/2026-11-04-breakfast-v1.png"
  }
]
```

설치된 Codex 스킬의 업로드 도우미를 사용할 경우 먼저 dry-run을 실행한다.

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/babfull-weekly-trays/scripts/upload_tray_images.mjs" \
  --manifest /tmp/babfull-tray-manifest.json \
  --project-ref uupatosmuueifsssdkev
```

조회 결과가 식사 날짜·구분과 정확히 일치하고 업로드 권한이 확인된 경우에만 `--apply`를 추가한다.

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/babfull-weekly-trays/scripts/upload_tray_images.mjs" \
  --manifest /tmp/babfull-tray-manifest.json \
  --project-ref uupatosmuueifsssdkev \
  --apply
```

도우미는 Storage에 새 파일을 올리고 `meal_tray_images`를 해당 `meal_id`와 연결한다. 기존 이미지 교체 시에는 데이터베이스가 새 이미지로 정상 변경된 뒤에만 이전 Storage 객체를 제거한다.

인증값은 환경변수 또는 인증된 Supabase CLI 세션에서만 읽는다. 서비스 역할 키, 비밀번호, 액세스 토큰을 이 문서·manifest·Git 기록에 넣거나 로그로 출력하지 않는다.

### 6. 운영 화면 검증

- 관리자 화면에서 대상 식사가 `이미지 등록됨`으로 표시되는지 확인한다.
- 저장된 공개 URL이 실제 이미지로 응답하는지 확인한다.
- 식판 사진 모드에서 올바른 날짜와 식사 카드에 고정 이미지가 보이는지 확인한다.
- 이미지가 없는 식사는 임의 생성 이미지 대신 메뉴명이 적힌 흰 식판 대체 화면을 보여주는지 확인한다.
- 검증 목적으로 제공 모드를 임시 변경했다면 원래 설정으로 복구한다.

## 완료 보고 항목

- 대상 주차
- 생성 대상 식사와 정확한 메뉴 manifest
- 생성·재생성·제외된 식사
- 최종 로컬 파일 경로
- 업로드된 날짜와 조식/중식 구분
- 시각 검수 결과
- 운영 화면 확인 결과
- 각 이미지에 사용한 최종 프롬프트

