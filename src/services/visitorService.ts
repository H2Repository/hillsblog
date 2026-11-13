import { VisitorLog } from '../types';

const VISITOR_LOGS_STORAGE_KEY = 'hills_blog_visitor_logs_v1';

/**
 * Anonymizes an IP address for privacy protection
 */
function maskIp(ip?: string): string {
  if (!ip) return '***';
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.***`;
    }
  }
  if (ip.includes(':')) {
    const parts = ip.split(':');
    return `${parts.slice(0, 3).join(':')}:****`;
  }
  return '***';
}

/**
 * Detects visitor device type (Mobile, Desktop, Tablet)
 */
function detectDevice(): string {
  if (typeof navigator === 'undefined') return 'Desktop';
  const ua = navigator.userAgent || '';
  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
    return 'Tablet';
  }
  if (/Mobile|iP(hone|od)|Android|BlackBerry|IEMobile|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/i.test(ua)) {
    return 'Mobile';
  }
  return 'Desktop';
}

function getStoredVisitorLogs(): VisitorLog[] {
  try {
    const raw = localStorage.getItem(VISITOR_LOGS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Records a visitor's location and viewed content locally.
 */
export async function recordVisitorLocation(diaryId?: string, diaryTitle?: string): Promise<void> {
  if (!diaryId) return;

  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent || '';
    if (/bot|googlebot|crawler|spider|robot|crawling|headless/i.test(ua)) {
      return;
    }
  }

  const sessionKey = `visitor_loc_logged_global`;
  try {
    const lastLogged = localStorage.getItem(sessionKey);
    if (lastLogged) {
      const elapsed = Date.now() - Number(lastLogged);
      if (elapsed < 30 * 60 * 1000) return;
    }
    localStorage.setItem(sessionKey, String(Date.now()));
  } catch {}

  try {
    const logId = `vlog-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const logEntry: VisitorLog = {
      id: logId,
      timestamp: Date.now(),
      lat: 37.5665,
      lng: 126.9780,
      city: '서울',
      country: '대한민국',
      region: '',
      diaryId,
      diaryTitle: diaryTitle || '블로그 홈 피드',
      device: detectDevice(),
      ipMasked: maskIp(),
    };

    const existing = getStoredVisitorLogs();
    localStorage.setItem(VISITOR_LOGS_STORAGE_KEY, JSON.stringify([logEntry, ...existing].slice(0, 200)));
  } catch (err) {
    console.warn('Could not record local visitor location:', err);
  }
}

/**
 * Fetches locally stored visitor logs.
 */
export async function fetchVisitorLogsOnline(): Promise<VisitorLog[]> {
  return getStoredVisitorLogs();
}

/**
 * Subscribes to local visitor logs.
 */
export function subscribeVisitorLogs(
  onUpdate: (logs: VisitorLog[]) => void,
  _onError?: (error: Error) => void
): () => void {
  onUpdate(getStoredVisitorLogs());
  return () => {};
}

/**
 * Clears all local visitor logs.
 */
export async function clearAllVisitorLogs(): Promise<void> {
  try {
    localStorage.removeItem(VISITOR_LOGS_STORAGE_KEY);
  } catch (err) {
    console.error('Error clearing logs:', err);
  }
}
