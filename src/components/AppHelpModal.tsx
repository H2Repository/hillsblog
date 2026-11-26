import React, { useEffect, useState } from 'react';
import {
  X,
  HelpCircle,
  BookOpen,
  ShieldCheck,
  KeyRound,
  PenSquare,
  Clock,
  MapPin,
  Database,
  Wifi,
  Globe,
  Camera,
  Route,
  CloudUpload,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Smartphone,
} from 'lucide-react';
import { getInitialDisplayVersion } from '../services/appVersionService';
import { useLanguage } from '../context/LanguageContext';
import { SupportedLanguage } from '../i18n/translations';

interface AppHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type HelpTab = 'overview' | 'auth_auto' | 'feed_map' | 'sync_data';

interface HelpCopy {
  headerTitle: string;
  headerSubtitle: string;
  closeAria: string;
  tabOverview: string;
  tabAuthAuto: string;
  tabFeedMap: string;
  tabSyncData: string;
  overviewIntroTitle: string;
  overviewIntroBody: string;
  overviewCard1Title: string;
  overviewCard1Body: string;
  overviewCard2Title: string;
  overviewCard2Body: string;
  overviewCard3Title: string;
  overviewCard3Body: string;
  overviewCard4Title: string;
  overviewCard4Body: string;
  overviewTip: string;
  authSectionTitle: string;
  authReadOnlyTitle: string;
  authReadOnlyBadge: string;
  authReadOnlyBody: string;
  authStep1Title: string;
  authStep1Badge: string;
  authStep1Items: string[];
  authStep2Title: string;
  authStep2Badge: string;
  authStep2Body: string;
  autoDiaryTitle: string;
  autoDiaryItems: string[];
  feedSectionTitle: string;
  feedItems: string[];
  mapSectionTitle: string;
  mapItems: string[];
  syncSectionTitle: string;
  syncSectionBody: string;
  syncBadgeSynced: string;
  syncBadgeSyncedDesc: string;
  syncBadgeModified: string;
  syncBadgeModifiedDesc: string;
  syncBadgeNotOnServer: string;
  syncBadgeNotOnServerDesc: string;
  dataSectionTitle: string;
  dataSectionBody: string;
  dataItems: string[];
  footerHint: string;
  confirmBtn: string;
}

const HELP_COPY: Record<SupportedLanguage, HelpCopy> = {
  ko: {
    headerTitle: "Hill's Blog 앱 도움말",
    headerSubtitle: '여행 일기 작성, 지도 발자취, 자동 기록 및 서버 동기화 사용 설명서',
    closeAria: '도움말 닫기',
    tabOverview: '기본 시작',
    tabAuthAuto: '권한 · 자동기록',
    tabFeedMap: '피드 · 지도',
    tabSyncData: '동기화 · 백업',
    overviewIntroTitle: "Hill's Blog 한눈에 보기",
    overviewIntroBody:
      '사진·위치·감정 태그를 담아 여행 발자취를 기록하고, 지도 위 실제 이동 경로와 누적 주행 거리를 함께 감상할 수 있는 여행 일기 앱입니다. 오프라인 환경에서도 로컬 저장소(IndexedDB)에 먼저 안전하게 보관한 뒤, 온라인 복구 시 서버와 동기화합니다.',
    overviewCard1Title: '1. 블로그 피드 둘러보기',
    overviewCard1Body:
      '방문자(읽기 전용)도 모든 공개 일기, 사진, 지도 경로를 자유롭게 감상할 수 있습니다. 상단 검색창과 지역·감정 필터로 원하는 기록을 바로 찾아보세요.',
    overviewCard2Title: '2. 5개 언어 번역 지원',
    overviewCard2Body:
      '상단 언어 선택기에서 한국어(KO), 영어(EN), 일본어(JA), 베트남어(VI), 스페인어(ES)로 화면과 일기 본문을 전환할 수 있습니다.',
    overviewCard3Title: '3. 새 일기 작성 & 편집',
    overviewCard3Body:
      '설정 메뉴에서 앱 사용 패스워드를 해제하면 상단의 일기 쓰기 버튼과 카드별 수정·삭제 기능이 활성화됩니다.',
    overviewCard4Title: '4. 홈 화면 설치 (PWA)',
    overviewCard4Body:
      '모바일·데스크톱 브라우저에서 앱으로 설치해 두면 오프라인 상태에서도 기존 일기와 지도를 빠르게 열어볼 수 있습니다.',
    overviewTip:
      '팁: 우측 상단 메뉴(≡) 안의 현재 위치 확인하기를 누르면 지금 있는 곳의 지역명과 주소를 즉시 조회할 수 있습니다.',
    authSectionTitle: '2단계 권한 구조',
    authReadOnlyTitle: '기본 상태 · 읽기 전용',
    authReadOnlyBadge: '방문자',
    authReadOnlyBody:
      '블로그 피드, 상세 보기, 사진 확대, 히스토리 지도 탐색 및 언어 전환이 가능합니다. 쓰기/수정/삭제 및 데이터 관리 메뉴는 표시되지 않습니다.',
    authStep1Title: '1단계 · 앱 사용 패스워드 해제',
    authStep1Badge: '로컬 편집 허용',
    authStep1Items: [
      '우측 상단 메뉴(≡) → 앱 사용 패스워드 입력에서 잠금을 해제합니다.',
      '상단 일기 쓰기 버튼, 카드 수정·삭제, 데이터 관리, 자동 위치·일기 작성 메뉴가 열립니다.',
      '사용을 마친 뒤 로컬 편집 잠금을 누르면 즉시 읽기 전용으로 돌아갑니다.',
    ],
    authStep2Title: '2단계 · 블로그 관리자 로그인 (Google)',
    authStep2Badge: '서버 동기화 허용',
    authStep2Body:
      '1단계 잠금 해제 후 블로그 관리자 로그인 (Google)으로 인증하면, 작성·수정한 일기와 사진을 서버 데이터베이스에 업로드하고 삭제 내역을 동기화할 수 있습니다.',
    autoDiaryTitle: '자동 위치·일기 작성',
    autoDiaryItems: [
      '앱 사용 패스워드를 해제하면 설정 메뉴에 자동 위치·일기 작성 스위치가 나타납니다.',
      '스위치를 ON으로 켜면 설정한 주기(기본 60분, 5~120분 프리셋 또는 직접 입력)마다 현재 GPS 위치와 이동 거리를 확인합니다.',
      '이전 기록 위치에서 일정 거리 이상 이동했을 때 해당 지역과 주소로 여행 발자취 일기를 자동 생성합니다.',
      '지금 기록 버튼을 누르면 주기를 기다리지 않고 즉시 위치 확인 및 기록을 실행합니다 (OFF 상태에서는 비활성화).',
    ],
    feedSectionTitle: '일기 작성 및 블로그 피드',
    feedItems: [
      '위치 지정: 작성 창에서 현재 GPS 좌표를 불러오거나 주소를 입력해 여행지 위치를 저장할 수 있습니다.',
      '사진 및 대표 이미지: 여러 장의 사진을 첨부하고 대표 사진(Cover)을 지정할 수 있으며, 상세 화면에서 클릭 시 확대 보기(라이트박스)가 열립니다.',
      '누적 주행거리 옵션: 이동 경로 계산에서 빼고 싶은 기록은 편집 화면에서 누적 주행거리 제외를 체크할 수 있습니다.',
      '검색 및 필터: 제목·본문·지역 검색어와 감정 태그, 정렬 기준(최신순/과거순)으로 일기를 모아볼 수 있습니다.',
    ],
    mapSectionTitle: '히스토리 지도 & 발자취 경로',
    mapItems: [
      '상단 탭에서 히스토리 지도를 선택하면 시간 순서(1, 2, 3…)대로 연결된 여행 경로와 마커가 표시됩니다.',
      '지도 우측 상단의 전체 경로 버튼으로 모든 방문지를 한 화면에 맞추고, 실시간 내 위치 버튼으로 현재 GPS 위치로 즉시 이동할 수 있습니다.',
      '발자취 경로 순서 패널에서 총 여정 거리(km)와 방문 여행지 수를 확인하고, 목록의 여행지를 클릭하면 해당 위치와 일기로 바로 이동합니다.',
    ],
    syncSectionTitle: '서버 연결 & 일기 동기화 배지',
    syncSectionBody:
      '상단 헤더의 온라인 / 오프라인 버튼을 누르면 서버 연결 상태와 동기화 현황을 즉시 새로고침합니다. 각 일기 카드의 동기화 상태 배지는 다음과 같습니다.',
    syncBadgeSynced: '서버됨 (녹색)',
    syncBadgeSyncedDesc: '로컬과 서버가 동일하게 최신 상태로 동기화되었습니다.',
    syncBadgeModified: '수정됨 (주황색)',
    syncBadgeModifiedDesc: '로컬에서 변경된 내용이 있어 서버 재업로드가 필요합니다.',
    syncBadgeNotOnServer: '미등록 (빨간색)',
    syncBadgeNotOnServerDesc: '로컬에만 저장되어 있습니다. 클릭해 서버로 올릴 수 있습니다.',
    dataSectionTitle: '데이터 관리 (백업 · 가져오기 · 일괄 업로드)',
    dataSectionBody:
      '관리자 잠금 해제 시 메뉴의 데이터 관리 (백업 및 가져오기) 항목을 사용할 수 있습니다.',
    dataItems: [
      '백업 다운로드: 전체 일기, 최근 수정·미등록 일기, 또는 원하는 기간을 지정해 JSON 파일로 내려받습니다.',
      'JSON 가져오기: 백업해 둔 JSON 파일을 불러와 로컬 저장소에 병합·복원합니다.',
      '일괄 서버 업로드 & 로컬 초기화: 미동기화 일기를 한 번에 서버로 올리거나, 로컬 저장소를 비우고 서버 데이터를 다시 내려받을 수 있습니다.',
    ],
    footerHint: '메뉴(≡) > 앱 도움말에서 언제든 다시 열 수 있습니다.',
    confirmBtn: '확인',
  },
  en: {
    headerTitle: "Hill's Blog App Help",
    headerSubtitle: 'Guide for writing diaries, travel maps, auto-logging & server sync',
    closeAria: 'Close help',
    tabOverview: 'Getting Started',
    tabAuthAuto: 'Access & Auto-Log',
    tabFeedMap: 'Feed & Map',
    tabSyncData: 'Sync & Backup',
    overviewIntroTitle: "Hill's Blog at a Glance",
    overviewIntroBody:
      'A travel diary app to record journeys with photos, GPS locations, and mood tags while viewing connected routes and cumulative road distance on the map. Entries are saved locally first (IndexedDB) even offline and synced with the server when online.',
    overviewCard1Title: '1. Browse Blog Feed',
    overviewCard1Body:
      'Visitors (Read Only) can freely browse all public diaries, photos, and map routes. Use search, region, and mood tag filters to find stories.',
    overviewCard2Title: '2. 5-Language Support',
    overviewCard2Body:
      'Switch UI and diary content between Korean (KO), English (EN), Japanese (JA), Vietnamese (VI), and Spanish (ES) from the top language selector.',
    overviewCard3Title: '3. Write & Edit Diaries',
    overviewCard3Body:
      'Unlock the App Passcode inside the menu to enable the Write Diary button and card Edit / Delete actions.',
    overviewCard4Title: '4. Install as App (PWA)',
    overviewCard4Body:
      'Install via your browser to open saved diaries and maps quickly even when offline.',
    overviewTip:
      'Tip: Use "Check Current Location" in the top-right menu (≡) to look up your current region and address anytime.',
    authSectionTitle: 'Two-Step Access Control',
    authReadOnlyTitle: 'Default · Read Only',
    authReadOnlyBadge: 'Visitor',
    authReadOnlyBody:
      'Allows reading diaries, zooming photos, exploring the map, and switching languages. Editing and Data Management are hidden.',
    authStep1Title: 'Step 1 · Unlock App Passcode',
    authStep1Badge: 'Local Edit',
    authStep1Items: [
      'Open Menu (≡) → Enter App Passcode to unlock local editing.',
      'Unlocks Write Diary, card Edit/Delete, Data Management, and Auto Location & Diary settings.',
      'Tap Lock Local Edit anytime to return immediately to Read Only mode.',
    ],
    authStep2Title: 'Step 2 · Blog Admin Login (Google)',
    authStep2Badge: 'Server Sync',
    authStep2Body:
      'After Step 1 unlock, sign in with Blog Admin Google account to upload new/modified diaries and sync deletions to the server database.',
    autoDiaryTitle: 'Auto Location & Diary',
    autoDiaryItems: [
      'Once App Passcode is unlocked, the Auto Location & Diary switch appears in the menu.',
      'When ON, it checks GPS and travel distance at the configured interval (default 60 min; 5–120 min presets or custom).',
      'When you move beyond a minimum distance from the previous entry, a new travel entry is created automatically.',
      'Tap Record Now to run a check immediately (disabled while OFF).',
    ],
    feedSectionTitle: 'Writing & Blog Feed',
    feedItems: [
      'Location: Fetch live GPS coordinates or enter an address directly in the editor.',
      'Photos & Cover: Attach multiple photos, pick a cover image, and tap photos in detail view to open the lightbox.',
      'Distance Exclusion: Check "Exclude from cumulative distance" on entries you want omitted from route totals.',
      'Search & Sort: Filter by keyword, region, mood tag, and sort newest or oldest first.',
    ],
    mapSectionTitle: 'Interactive Map & Trail Order',
    mapItems: [
      'Open the Interactive Map tab to view markers and chronologically numbered routes (1, 2, 3…).',
      'Use "Full Route" to fit all stops on screen or "Live My Location" to jump to your current GPS spot.',
      'Check total distance (km) and stop count in the Route Stop Order panel, and click any stop to jump right to it.',
    ],
    syncSectionTitle: 'Server Status & Diary Sync Badges',
    syncSectionBody:
      'Tap Online / Offline in the top bar to refresh connection status. Card sync badges indicate:',
    syncBadgeSynced: 'Synced (Green)',
    syncBadgeSyncedDesc: 'Local copy matches the latest server record.',
    syncBadgeModified: 'Modified (Amber)',
    syncBadgeModifiedDesc: 'Edited locally; click to update the server.',
    syncBadgeNotOnServer: 'Local only (Red)',
    syncBadgeNotOnServerDesc: 'Stored locally only. Click to upload to the server.',
    dataSectionTitle: 'Data Management (Backup · Import · Batch Sync)',
    dataSectionBody:
      'Available in the menu once unlocked for editing or admin access:',
    dataItems: [
      'Export Backup: Download all, modified/local-only, or date-range diaries as a JSON file.',
      'Import JSON: Merge and restore previously exported JSON files into local storage.',
      'Batch Upload & Reset: Upload all pending diaries at once or reset local storage and reload from the server.',
    ],
    footerHint: 'Reopen anytime from Menu (≡) > App Help.',
    confirmBtn: 'OK',
  },
  ja: {
    headerTitle: "Hill's Blog アプリヘルプ",
    headerSubtitle: '旅日記の作成、地図軌跡、自動記録およびサーバー同期ガイド',
    closeAria: 'ヘルプを閉じる',
    tabOverview: '基本ガイド',
    tabAuthAuto: '権限・自動記録',
    tabFeedMap: 'フィード・地図',
    tabSyncData: '同期・バックアップ',
    overviewIntroTitle: "Hill's Blog 概要",
    overviewIntroBody:
      '写真・位置情報・ムードタグとともに旅の足跡を残し、地図上の移動ルートや累計走行距離を確認できる旅日記アプリです。オフライン環境でもまずローカル保存領域（IndexedDB）に安全に保管し、オンライン復帰時にサーバーと同期します。',
    overviewCard1Title: '1. ブログフィードを見る',
    overviewCard1Body:
      '閲覧者も公開日記、写真、地図ルートを自由に閲覧できます。検索バーや地域・タグフィルターで記録をすぐ探せます。',
    overviewCard2Title: '2. 5言語翻訳に対応',
    overviewCard2Body:
      '上部の言語切替から日本語(JA)、韓国語(KO)、英語(EN)、ベトナム語(VI)、スペイン語(ES)に画面と日記を切り替えられます。',
    overviewCard3Title: '3. 日記の作成と編集',
    overviewCard3Body:
      'メニューでアプリパスワードを解除すると、上部の「日記を書く」ボタンとカードの編集・削除アイコンが有効になります。',
    overviewCard4Title: '4. ホーム画面に追加 (PWA)',
    overviewCard4Body:
      'ブラウザからアプリとしてインストールすれば、オフラインでも保存済みの日記や地図をすぐ開けます。',
    overviewTip:
      'ヒント: 右上メニュー(≡)の「現在地を確認する」を押すと、現在の地域名と住所をすぐに確認できます。',
    authSectionTitle: '2段階の権限構造',
    authReadOnlyTitle: '初期状態 · 閲覧専用',
    authReadOnlyBadge: '閲覧者',
    authReadOnlyBody:
      '日記の閲覧、写真拡大、地図探索、言語切替が可能です。作成・編集・削除やデータ管理メニューは表示されません。',
    authStep1Title: '第1段階 · アプリパスワード解除',
    authStep1Badge: 'ローカル編集可',
    authStep1Items: [
      '右上メニュー(≡) → アプリパスワード入力からロックを解除します。',
      '「日記を書く」、カードの編集・削除、データ管理、自動位置・日記記録メニューが表示されます。',
      '作業後は「ローカル編集をロック」で即座に閲覧専用へ戻せます。',
    ],
    authStep2Title: '第2段階 · ブログ管理者ログイン (Google)',
    authStep2Badge: 'サーバー同期可',
    authStep2Body:
      '第1段階解除後にGoogle管理者アカウントでログインすると、作成・編集した日記と写真をサーバーDBへアップロードし削除も同期できます。',
    autoDiaryTitle: '自動位置・日記記録',
    autoDiaryItems: [
      'アプリパスワード解除後、メニューに「自動位置・日記記録」スイッチが表示されます。',
      'ONにすると設定間隔（既定60分、5〜120分プリセットまたは手入力）ごとにGPSと移動距離を確認します。',
      '前回記録地点から一定距離以上移動すると、その地域と住所で旅日記を自動生成します。',
      '「今すぐ記録」で待たずに即時記録できます（OFF時は無効）。',
    ],
    feedSectionTitle: '日記作成・ブログフィード',
    feedItems: [
      '位置指定: エディタで現在GPSを取得したり住所を入力して保存できます。',
      '写真・カバー: 複数枚の写真を添付し代表写真を設定可能。詳細画面でクリックすると拡大表示されます。',
      '距離除外オプション: 累計走行距離に含めたくない記録は編集画面で「距離計算から除外」を選択できます。',
      '検索・並び替え: キーワード、地域、タグ、新しい順/古い順で絞り込みできます。',
    ],
    mapSectionTitle: 'インタラクティブ地図・順路',
    mapItems: [
      '「インタラクティブ地図」タブで時系列（1, 2, 3…）に繋がったルートとマーカーを表示します。',
      '地図右上の「全体ルート」で全地点を画面に収め、「リアルタイム現在地」で現在GPS地点へ移動できます。',
      '「走行ルート順路」パネルで総走行距離(km)と訪問地点数を確認し、一覧から該当スポットへ移動できます。',
    ],
    syncSectionTitle: 'サーバー接続・同期バッジ',
    syncSectionBody:
      '上部バーの「オンライン / オフライン」を押すと接続状態を更新します。各日記カードのバッジ意味は次の通りです。',
    syncBadgeSynced: 'サーバー済（緑）',
    syncBadgeSyncedDesc: 'ローカルとサーバーが最新状態で同期済みです。',
    syncBadgeModified: '修正済（橙）',
    syncBadgeModifiedDesc: 'ローカルで変更されています。クリックして更新します。',
    syncBadgeNotOnServer: '未登録（赤）',
    syncBadgeNotOnServerDesc: 'ローカルのみに保存中。クリックしてサーバーへ送信できます。',
    dataSectionTitle: 'データ管理（バックアップ・取込・一括送信）',
    dataSectionBody:
      'ロック解除時にメニューの「データ管理（バックアップ・取込）」が利用できます。',
    dataItems: [
      'バックアップ保存: 全日記、修正・未登録日記、または期間指定でJSONファイルをダウンロードします。',
      'JSON取込: 保存済みJSONファイルを読み込んでローカルに統合・復元します。',
      '一括送信・ローカル初期化: 未同期日記をまとめて送信したり、ローカルを初期化してサーバーから再取得できます。',
    ],
    footerHint: 'メニュー(≡) > アプリヘルプからいつでも開けます。',
    confirmBtn: '確認',
  },
  vi: {
    headerTitle: "Trợ giúp Hill's Blog",
    headerSubtitle: 'Hướng dẫn viết nhật ký, bản đồ hành trình, tự động ghi & đồng bộ máy chủ',
    closeAria: 'Đóng trợ giúp',
    tabOverview: 'Bắt đầu',
    tabAuthAuto: 'Quyền & Tự động',
    tabFeedMap: 'Bảng tin & Bản đồ',
    tabSyncData: 'Đồng bộ & Sao lưu',
    overviewIntroTitle: "Tổng quan Hill's Blog",
    overviewIntroBody:
      'Ứng dụng nhật ký hành trình lưu giữ ảnh, vị trí GPS và thẻ cảm xúc cùng lộ trình trên bản đồ và tổng quãng đường tích lũy. Dữ liệu luôn được lưu cục bộ an toàn (IndexedDB) ngay cả khi ngoại tuyến và đồng bộ lên máy chủ khi có mạng.',
    overviewCard1Title: '1. Xem bảng tin nhật ký',
    overviewCard1Body:
      'Khách (chỉ đọc) có thể xem tự do toàn bộ nhật ký, hình ảnh và bản đồ. Dùng thanh tìm kiếm và bộ lọc khu vực/thẻ để tìm nhanh.',
    overviewCard2Title: '2. Hỗ trợ 5 ngôn ngữ',
    overviewCard2Body:
      'Chuyển giao diện và nội dung nhật ký giữa Tiếng Việt (VI), Hàn (KO), Anh (EN), Nhật (JA), Tây Ban Nha (ES) ở góc trên.',
    overviewCard3Title: '3. Viết & Chỉnh sửa nhật ký',
    overviewCard3Body:
      'Mở khóa mật khẩu ứng dụng trong menu để bật nút Viết nhật ký và các nút sửa/xóa trên từng thẻ.',
    overviewCard4Title: '4. Cài đặt ứng dụng (PWA)',
    overviewCard4Body:
      'Cài đặt từ trình duyệt để mở lại các nhật ký và bản đồ đã lưu ngay cả khi không có kết nối mạng.',
    overviewTip:
      'Mẹo: Nhấn "Kiểm tra vị trí hiện tại" trong menu (≡) để xem nhanh khu vực và địa chỉ bạn đang đứng.',
    authSectionTitle: 'Cơ chế phân quyền 2 bước',
    authReadOnlyTitle: 'Mặc định · Chỉ đọc',
    authReadOnlyBadge: 'Khách',
    authReadOnlyBody:
      'Cho phép đọc nhật ký, phóng to ảnh, xem bản đồ và đổi ngôn ngữ. Chức năng chỉnh sửa và quản lý dữ liệu được ẩn.',
    authStep1Title: 'Bước 1 · Mở khóa mật khẩu ứng dụng',
    authStep1Badge: 'Sửa cục bộ',
    authStep1Items: [
      'Mở Menu (≡) → Nhập mật khẩu ứng dụng để mở khóa chỉnh sửa cục bộ.',
      'Hiển thị nút Viết nhật ký, sửa/xóa thẻ, Quản lý dữ liệu và cài đặt Tự động vị trí & nhật ký.',
      'Nhấn Khóa chỉnh sửa cục bộ bất cứ lúc nào để quay lại chế độ chỉ đọc.',
    ],
    authStep2Title: 'Bước 2 · Đăng nhập Quản trị (Google)',
    authStep2Badge: 'Đồng bộ máy chủ',
    authStep2Body:
      'Sau Bước 1, đăng nhập bằng tài khoản Google quản trị để tải nhật ký/ảnh lên máy chủ và đồng bộ xóa dữ liệu.',
    autoDiaryTitle: 'Tự động vị trí & nhật ký',
    autoDiaryItems: [
      'Khi mở khóa mật khẩu, công tắc Tự động vị trí & nhật ký sẽ xuất hiện trong menu.',
      'Khi BẬT, ứng dụng kiểm tra GPS và quãng đường theo chu kỳ (mặc định 60 phút, chọn nhanh 5–120 phút hoặc nhập tay).',
      'Khi bạn di chuyển đủ xa khỏi điểm ghi trước đó, nhật ký mới sẽ được tạo tự động.',
      'Nhấn Ghi ngay để kiểm tra và ghi tức thì (tạm khóa khi ở trạng thái OFF).',
    ],
    feedSectionTitle: 'Viết nhật ký & Bảng tin',
    feedItems: [
      'Vị trí: Lấy tọa độ GPS hiện tại hoặc nhập địa chỉ trực tiếp khi viết.',
      'Ảnh & Ảnh bìa: Đính kèm nhiều ảnh, chọn ảnh bìa và nhấn vào ảnh để phóng to.',
      'Loại trừ quãng đường: Có thể đánh dấu loại trừ khỏi tổng quãng đường tích lũy khi chỉnh sửa.',
      'Tìm kiếm & Sắp xếp: Lọc theo từ khóa, khu vực, thẻ cảm xúc và sắp xếp mới nhất / cũ nhất.',
    ],
    mapSectionTitle: 'Bản đồ tương tác & Lộ trình',
    mapItems: [
      'Chọn tab Bản đồ tương tác để xem các điểm đánh dấu và tuyến đường theo thứ tự thời gian (1, 2, 3…).',
      'Dùng nút "Toàn bộ lộ trình" để thu phóng vừa màn hình hoặc "Vị trí hiện tại của tôi" để về vị trí GPS.',
      'Xem tổng quãng đường (km) và số điểm đã ghé ở bảng Thứ tự các điểm dừng chân.',
    ],
    syncSectionTitle: 'Trạng thái máy chủ & Thẻ đồng bộ',
    syncSectionBody:
      'Nhấn nút Trực tuyến / Ngoại tuyến ở thanh trên để làm mới kết nối. Ý nghĩa các thẻ đồng bộ:',
    syncBadgeSynced: 'Đã lưu (Xanh lá)',
    syncBadgeSyncedDesc: 'Bản cục bộ khớp với dữ liệu mới nhất trên máy chủ.',
    syncBadgeModified: 'Đã sửa (Cam)',
    syncBadgeModifiedDesc: 'Đã chỉnh sửa trên máy; nhấn để cập nhật lên máy chủ.',
    syncBadgeNotOnServer: 'Chưa lưu (Đỏ)',
    syncBadgeNotOnServerDesc: 'Chỉ mới lưu trên máy. Nhấn để tải lên máy chủ.',
    dataSectionTitle: 'Quản lý dữ liệu (Sao lưu · Nhập · Tải hàng loạt)',
    dataSectionBody:
      'Khả dụng trong menu sau khi mở khóa chỉnh sửa hoặc đăng nhập quản trị:',
    dataItems: [
      'Tải sao lưu: Xuất toàn bộ, mục chưa đồng bộ hoặc theo khoảng ngày ra tệp JSON.',
      'Nhập JSON: Gộp và khôi phục dữ liệu từ tệp JSON đã sao lưu.',
      'Tải lên hàng loạt & Đặt lại: Tải lên tất cả nhật ký chưa đồng bộ hoặc xóa bộ nhớ cục bộ để tải lại từ máy chủ.',
    ],
    footerHint: 'Có thể mở lại bất cứ lúc nào tại Menu (≡) > Trợ giúp ứng dụng.',
    confirmBtn: 'Đóng',
  },
  es: {
    headerTitle: "Ayuda de Hill's Blog",
    headerSubtitle: 'Guía para escribir diarios, mapa de ruta, registro automático y sincronización',
    closeAria: 'Cerrar ayuda',
    tabOverview: 'Inicio',
    tabAuthAuto: 'Permisos y Auto',
    tabFeedMap: 'Muro y Mapa',
    tabSyncData: 'Sincronización',
    overviewIntroTitle: "Hill's Blog de un vistazo",
    overviewIntroBody:
      'Una app de diario de viaje para registrar rutas con fotos, ubicación GPS y etiquetas de estado de ánimo mientras exploras el recorrido y la distancia acumulada en el mapa. Guarda primero en almacenamiento local (IndexedDB) incluso sin conexión y sincroniza al volver en línea.',
    overviewCard1Title: '1. Explorar el muro',
    overviewCard1Body:
      'Los visitantes (Solo lectura) pueden ver todos los diarios, fotos y rutas. Usa el buscador y filtros de región o etiqueta.',
    overviewCard2Title: '2. 5 idiomas disponibles',
    overviewCard2Body:
      'Cambia la interfaz y el contenido entre español (ES), coreano (KO), inglés (EN), japonés (JA) y vietnamita (VI).',
    overviewCard3Title: '3. Escribir y editar',
    overviewCard3Body:
      'Desbloquea el código de acceso en el menú para activar el botón Escribir diario y editar o eliminar entradas.',
    overviewCard4Title: '4. Instalar como app (PWA)',
    overviewCard4Body:
      'Instálala desde el navegador para consultar tus diarios y mapas guardados incluso sin conexión.',
    overviewTip:
      'Consejo: Usa "Comprobar ubicación actual" en el menú (≡) para ver al instante tu región y dirección.',
    authSectionTitle: 'Control de acceso en 2 pasos',
    authReadOnlyTitle: 'Por defecto · Solo lectura',
    authReadOnlyBadge: 'Visitante',
    authReadOnlyBody:
      'Permite leer diarios, ampliar fotos, explorar el mapa y cambiar de idioma. La edición y gestión de datos quedan ocultas.',
    authStep1Title: 'Paso 1 · Desbloquear código de acceso',
    authStep1Badge: 'Edición local',
    authStep1Items: [
      'Abre Menú (≡) → Introducir código de acceso para habilitar la edición local.',
      'Activa Escribir diario, editar/borrar tarjetas, Gestión de datos y Ubicación y diario automático.',
      'Pulsa Bloquear edición local cuando termines para volver al modo Solo lectura.',
    ],
    authStep2Title: 'Paso 2 · Acceso Admin del Blog (Google)',
    authStep2Badge: 'Sincronización',
    authStep2Body:
      'Tras el Paso 1, inicia sesión con la cuenta Google de administrador para subir diarios nuevos/editados y sincronizar eliminaciones.',
    autoDiaryTitle: 'Ubicación y diario automático',
    autoDiaryItems: [
      'Al desbloquear el código, verás el interruptor de Ubicación y diario automático en el menú.',
      'Al activarlo (ON), comprueba tu GPS y distancia según el intervalo configurado (60 min por defecto; 5–120 min).',
      'Si te desplazas una distancia mínima desde la entrada anterior, crea automáticamente un nuevo registro.',
      'Pulsa Registrar ahora para comprobar al momento (desactivado cuando está en OFF).',
    ],
    feedSectionTitle: 'Redacción y muro de diarios',
    feedItems: [
      'Ubicación: Obtén coordenadas GPS en vivo o escribe la dirección manualmente.',
      'Fotos y portada: Adjunta varias fotos, elige portada y pulsa cualquier imagen en el detalle para ampliarla.',
      'Excluir distancia: Marca excluir de la distancia acumulada en entradas que no deban sumarse.',
      'Búsqueda y orden: Filtra por texto, región o etiqueta y ordena por más recientes o antiguos.',
    ],
    mapSectionTitle: 'Mapa interactivo y orden de paradas',
    mapItems: [
      'En la pestaña Mapa interactivo verás los marcadores y rutas numeradas cronológicamente (1, 2, 3…).',
      'Usa "Ruta completa" para encuadrar todo el viaje o "Mi ubicación en tiempo real" para centrar el mapa en tu GPS.',
      'Consulta la distancia total (km) y paradas visitadas en el panel Orden de paradas.',
    ],
    syncSectionTitle: 'Estado del servidor e insignias',
    syncSectionBody:
      'Pulsa En línea / Sin conexión en la barra superior para actualizar la conexión. Insignias de cada diario:',
    syncBadgeSynced: 'En servidor (Verde)',
    syncBadgeSyncedDesc: 'La copia local coincide con la del servidor.',
    syncBadgeModified: 'Editado (Ámbar)',
    syncBadgeModifiedDesc: 'Modificado en local; pulsa para actualizar el servidor.',
    syncBadgeNotOnServer: 'Sin subir (Rojo)',
    syncBadgeNotOnServerDesc: 'Guardado solo en local. Pulsa para subirlo al servidor.',
    dataSectionTitle: 'Gestión de datos (Copia · Importar · Subida masiva)',
    dataSectionBody:
      'Disponible en el menú tras desbloquear el código de acceso o iniciar sesión como administrador:',
    dataItems: [
      'Descargar copia: Exporta todo, pendientes o un rango de fechas en JSON.',
      'Importar JSON: Combina y restaura archivos JSON guardados en el almacenamiento local.',
      'Subida masiva y reinicio: Sube todos los diarios pendientes a la vez o reinicia el almacenamiento local desde el servidor.',
    ],
    footerHint: 'Puedes volver a abrir esta guía en Menú (≡) > Ayuda de la app.',
    confirmBtn: 'Aceptar',
  },
};

export const AppHelpModal: React.FC<AppHelpModalProps> = ({ isOpen, onClose }) => {
  const { language } = useLanguage();
  const [activeTab, setActiveTab] = useState<HelpTab>('overview');
  const appVersion = getInitialDisplayVersion();
  const copy = HELP_COPY[language] || HELP_COPY.en;

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const tabs: { id: HelpTab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: copy.tabOverview, icon: <BookOpen className="w-3.5 h-3.5" /> },
    { id: 'auth_auto', label: copy.tabAuthAuto, icon: <ShieldCheck className="w-3.5 h-3.5" /> },
    { id: 'feed_map', label: copy.tabFeedMap, icon: <MapPin className="w-3.5 h-3.5" /> },
    { id: 'sync_data', label: copy.tabSyncData, icon: <Database className="w-3.5 h-3.5" /> },
  ];

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-stone-200 overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-stone-900 px-5 py-4 text-white flex items-center justify-between shrink-0 border-b border-stone-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-amber-600/20 text-amber-400 border border-amber-500/40 flex items-center justify-center shrink-0">
              <HelpCircle className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold tracking-tight flex items-center gap-2">
                <span className="truncate">{copy.headerTitle}</span>
                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-stone-800 text-amber-300 border border-stone-700 shrink-0">
                  {appVersion}
                </span>
              </h2>
              <p className="text-xs text-stone-400 truncate">{copy.headerSubtitle}</p>
            </div>
          </div>
          <button
            id="btn-close-help-modal"
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-stone-400 hover:text-white hover:bg-stone-800 transition cursor-pointer shrink-0"
            aria-label={copy.closeAria}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="px-4 sm:px-5 pt-3 bg-stone-50 border-b border-stone-200 flex items-center gap-1.5 overflow-x-auto shrink-0">
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-t-xl border-b-2 transition whitespace-nowrap cursor-pointer ${
                  active
                    ? 'border-amber-600 text-amber-700 bg-white'
                    : 'border-transparent text-stone-500 hover:text-stone-800 hover:bg-stone-100/80'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 text-stone-700 text-xs sm:text-sm leading-relaxed">
          {activeTab === 'overview' && (
            <>
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200/80">
                <div className="flex items-center gap-2 font-bold text-amber-900 mb-1">
                  <Sparkles className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>{copy.overviewIntroTitle}</span>
                </div>
                <p className="text-xs text-amber-900/90 leading-relaxed">{copy.overviewIntroBody}</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3.5 rounded-xl bg-stone-50 border border-stone-200 space-y-1.5">
                  <div className="flex items-center gap-2 font-bold text-stone-900 text-xs sm:text-sm">
                    <BookOpen className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>{copy.overviewCard1Title}</span>
                  </div>
                  <p className="text-xs text-stone-600">{copy.overviewCard1Body}</p>
                </div>

                <div className="p-3.5 rounded-xl bg-stone-50 border border-stone-200 space-y-1.5">
                  <div className="flex items-center gap-2 font-bold text-stone-900 text-xs sm:text-sm">
                    <Globe className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{copy.overviewCard2Title}</span>
                  </div>
                  <p className="text-xs text-stone-600">{copy.overviewCard2Body}</p>
                </div>

                <div className="p-3.5 rounded-xl bg-stone-50 border border-stone-200 space-y-1.5">
                  <div className="flex items-center gap-2 font-bold text-stone-900 text-xs sm:text-sm">
                    <PenSquare className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>{copy.overviewCard3Title}</span>
                  </div>
                  <p className="text-xs text-stone-600">{copy.overviewCard3Body}</p>
                </div>

                <div className="p-3.5 rounded-xl bg-stone-50 border border-stone-200 space-y-1.5">
                  <div className="flex items-center gap-2 font-bold text-stone-900 text-xs sm:text-sm">
                    <Smartphone className="w-4 h-4 text-stone-700 shrink-0" />
                    <span>{copy.overviewCard4Title}</span>
                  </div>
                  <p className="text-xs text-stone-600">{copy.overviewCard4Body}</p>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-stone-100 border border-stone-200 text-xs text-stone-600">
                {copy.overviewTip}
              </div>
            </>
          )}

          {activeTab === 'auth_auto' && (
            <>
              <div className="space-y-2.5">
                <h3 className="text-xs sm:text-sm font-bold text-stone-900 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>{copy.authSectionTitle}</span>
                </h3>

                <div className="p-3.5 rounded-xl bg-stone-50 border border-stone-200 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-stone-800">{copy.authReadOnlyTitle}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-stone-200 text-stone-700 font-bold">
                      {copy.authReadOnlyBadge}
                    </span>
                  </div>
                  <p className="text-xs text-stone-600">{copy.authReadOnlyBody}</p>
                </div>

                <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                      <KeyRound className="w-3.5 h-3.5 text-amber-600" />
                      {copy.authStep1Title}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-200/80 text-amber-900 font-bold">
                      {copy.authStep1Badge}
                    </span>
                  </div>
                  <ul className="text-xs text-stone-700 space-y-1 list-disc pl-4">
                    {copy.authStep1Items.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>

                <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                      {copy.authStep2Title}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-200/80 text-emerald-900 font-bold">
                      {copy.authStep2Badge}
                    </span>
                  </div>
                  <p className="text-xs text-stone-700">{copy.authStep2Body}</p>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-stone-50 border border-stone-200 space-y-2">
                <h3 className="text-xs sm:text-sm font-bold text-stone-900 flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-emerald-600" />
                  <span>{copy.autoDiaryTitle}</span>
                </h3>
                <ul className="text-xs text-stone-600 space-y-1 list-disc pl-4">
                  {copy.autoDiaryItems.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            </>
          )}

          {activeTab === 'feed_map' && (
            <>
              <div className="p-3.5 rounded-xl bg-stone-50 border border-stone-200 space-y-2">
                <h3 className="text-xs sm:text-sm font-bold text-stone-900 flex items-center gap-1.5">
                  <Camera className="w-4 h-4 text-amber-600" />
                  <span>{copy.feedSectionTitle}</span>
                </h3>
                <ul className="text-xs text-stone-600 space-y-1.5 list-disc pl-4">
                  {copy.feedItems.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>

              <div className="p-3.5 rounded-xl bg-stone-50 border border-stone-200 space-y-2">
                <h3 className="text-xs sm:text-sm font-bold text-stone-900 flex items-center gap-1.5">
                  <Route className="w-4 h-4 text-amber-600" />
                  <span>{copy.mapSectionTitle}</span>
                </h3>
                <ul className="text-xs text-stone-600 space-y-1.5 list-disc pl-4">
                  {copy.mapItems.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            </>
          )}

          {activeTab === 'sync_data' && (
            <>
              <div className="p-3.5 rounded-xl bg-stone-50 border border-stone-200 space-y-2.5">
                <h3 className="text-xs sm:text-sm font-bold text-stone-900 flex items-center gap-1.5">
                  <Wifi className="w-4 h-4 text-emerald-600" />
                  <span>{copy.syncSectionTitle}</span>
                </h3>
                <p className="text-xs text-stone-600">{copy.syncSectionBody}</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs">
                    <div className="font-bold text-emerald-800 flex items-center gap-1 mb-0.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>{copy.syncBadgeSynced}</span>
                    </div>
                    <p className="text-[11px] text-emerald-900/80">{copy.syncBadgeSyncedDesc}</p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs">
                    <div className="font-bold text-amber-800 flex items-center gap-1 mb-0.5">
                      <CloudUpload className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <span>{copy.syncBadgeModified}</span>
                    </div>
                    <p className="text-[11px] text-amber-900/80">{copy.syncBadgeModifiedDesc}</p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs">
                    <div className="font-bold text-rose-800 flex items-center gap-1 mb-0.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                      <span>{copy.syncBadgeNotOnServer}</span>
                    </div>
                    <p className="text-[11px] text-rose-900/80">{copy.syncBadgeNotOnServerDesc}</p>
                  </div>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-stone-50 border border-stone-200 space-y-2">
                <h3 className="text-xs sm:text-sm font-bold text-stone-900 flex items-center gap-1.5">
                  <Database className="w-4 h-4 text-amber-600" />
                  <span>{copy.dataSectionTitle}</span>
                </h3>
                <p className="text-xs text-stone-600">{copy.dataSectionBody}</p>
                <ul className="text-xs text-stone-600 space-y-1 list-disc pl-4">
                  {copy.dataItems.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-stone-50 border-t border-stone-200 flex items-center justify-between gap-3 shrink-0">
          <span className="text-[11px] text-stone-500">{copy.footerHint}</span>
          <button
            id="btn-confirm-help-modal"
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-stone-900 hover:bg-stone-800 text-white text-xs font-bold transition cursor-pointer shrink-0"
          >
            {copy.confirmBtn}
          </button>
        </div>
      </div>
    </div>
  );
};
