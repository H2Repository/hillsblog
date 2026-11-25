나의 여행 블로그 - AI STUDIO

## Hill's Blog 앱 구성 및 기술 스택

Hill's Blog 앱의 언어, 프레임워크, 데이터베이스 및 전체 구성은 다음과 같습니다.

### 1. 개발 언어 및 프론트엔드
- **개발 언어**: **TypeScript** (프론트엔드·백엔드 모두 TypeScript로 작성)
- **UI 프레임워크**: **React 19** + **Vite 6** (번들링/빌드 도구)
- **스타일링**: **Tailwind CSS v4**
- **지도 및 위치**: **Leaflet** + OpenStreetMap 지도 타일, 브라우저 GPS(`Geolocation API`), 역지오코딩 및 도로 거리 계산
- **오프라인 & 앱 설치(PWA)**: **Workbox Service Worker**(`vite-plugin-pwa`)로 오프라인 실행 및 홈 화면 설치 지원
- **앱 내 다국어 지원**: **한국어, 영어, 일본어, 베트남어, 스페인어** (5개 언어 UI 및 일기 번역 지원)

### 2. 백엔드 서버
- **런타임 / 웹 서버**: **Node.js** + **Express**
- **주요 역할**:
  - 일기 및 사진 조회·등록·수정·삭제 REST API 제공
  - `sharp` 라이브러리를 이용한 사진 썸네일 생성 및 바이너리 스트리밍
  - Firebase 관리자 인증 토큰 검증(`firebase-admin`)

### 3. 데이터베이스 (서버 DB + 로컬 DB 이중 구조)
- **서버 메인 DB**: **Google Cloud SQL (PostgreSQL)** + **Drizzle ORM**
  - `users`: 블로그 관리자 계정 정보 (`uid`, `email`)
  - `diaries`: 일기 본문, 날짜/시간, GPS 좌표(`lat`, `lng`), 주소, 날씨, 태그(`jsonb`), 평점 등
  - `diary_photos`: 사진 메타데이터와 실제 이미지 바이너리(`bytea` 컬럼)
- **브라우저 로컬 DB**: **IndexedDB** (+ 설정 저장용 `localStorage`)
  - 오프라인 상태에서도 일기와 사진을 로컬에 먼저 저장·열람할 수 있으며, 온라인 복구 시 서버와 동기화됩니다.

### 4. 인증 및 권한 구조 (2단계)
1. **1단계 — 앱 사용 패스워드**: 브라우저 로컬에서 SHA-256 해시로 검증하여 로컬 일기 추가/수정/삭제 및 자동 위치·일기 기록 기능 활성화
2. **2단계 — 블로그 관리자 로그인**: **Firebase Authentication (Google 로그인)** 후 백엔드에서 ID 토큰과 관리자 계정을 검증해 Cloud SQL 서버 동기화 허용

> **참고 (GitHub Actions 워크플로 관련)**  
> 이 프로젝트는 Jekyll이나 단순 정적 HTML이 아닌 **React + Vite + Express(Node.js) 풀스택 앱**입니다. GitHub Pages에 프론트엔드만이라도 올리시려면 Jekyll 워크플로나 `path: '.'` 대신 워크플로에서 **`npm ci` → `npm run build`**를 실행한 뒤 **`path: './dist'`**를 배포하셔야 하며, GitHub Pages 정적 호스팅에서는 Express 백엔드와 Cloud SQL은 동작하지 않습니다.
