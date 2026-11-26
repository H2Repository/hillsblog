export type WeatherType = 'sunny' | 'cloudy' | 'rainy' | 'snowy' | 'foggy' | 'windy';

export interface GeoLocation {
  lat: number;
  lng: number;
  accuracy?: number;
  address: string;
  region: string; // e.g., "제주 애월", "경주 황리단길", "강릉 안목"
  landmark?: string;
  isRealtimeGps?: boolean;
  includeInDistance?: boolean; // 누적 주행거리 계산 포함 여부 (기본: true)
}

export interface TravelPhoto {
  id: string;
  url: string;
  caption?: string;
  timestamp: string;
  isCover?: boolean;
  isChunked?: boolean;
  chunkCount?: number;
  thumbnailUrl?: string;
  isThumbnailOnly?: boolean;
}

export interface LocalInsights {
  recommendedForSolo: string; // 여행 추천 이유 & 코스 특징
  localFood?: string;         // 지역 향토 음식/라이더 보급 맛집
  transportTip?: string;      //  코스 접근성 / 교통 팁
  soloTravelTip?: string;     //  여행 여행 꿀팁
}

export interface DiaryEntry {
  id: string;
  title: string;
  content: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  location: GeoLocation;
  photos: TravelPhoto[];
  weather: WeatherType;
  moodTags: string[];
  localInsights: LocalInsights;
  rating: number; // 1 to 5
  hasSubcollectionPhotos?: boolean;
  totalPhotosCount?: number;
  includeInDistance?: boolean;
  createdAt: number;
  updatedAt: number;
  isModified?: boolean;
  localSyncStatus?: 'synced' | 'needs_update' | 'not_on_server';
}

export interface DiaryVisitRecord {
  id: string;
  diaryId: string;
  visitorName?: string;
  message: string;
  reaction: string;
  visitedAt: number;
}

export interface ExportedDiaryEntry extends DiaryEntry {
  visits?: DiaryVisitRecord[];
}

export type ViewMode = 'blog' | 'map' | 'timeline';
