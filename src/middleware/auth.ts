import type { NextFunction, Request, Response } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { adminAuth } from '../lib/firebase-admin.ts';
import { isBlogAdminUser } from '../db/users.ts';

export interface AuthRequest extends Request {
  user?: DecodedIdToken;
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: '인증 토큰이 필요합니다. Google 계정으로 로그인해주세요.' });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    res.status(401).json({ error: '유효하지 않은 인증 토큰입니다.' });
    return;
  }

  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    res.status(401).json({ error: '인증이 만료되었거나 유효하지 않습니다. 다시 로그인해주세요.' });
  }
};

export const requireAdmin = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const uid = req.user?.uid;
  const email = req.user?.email;
  if (!uid) {
    res.status(401).json({ error: '인증 정보가 없습니다.' });
    return;
  }
  try {
    const allowed = await isBlogAdminUser(uid, email);
    if (!allowed) {
      res.status(403).json({ error: '관리자 계정만 서버 데이터를 변경할 수 있습니다.' });
      return;
    }
    next();
  } catch (error) {
    console.error('Error checking admin permission:', error);
    res.status(500).json({ error: '관리자 권한 확인 중 오류가 발생했습니다.' });
  }
};
