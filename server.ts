import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { type AuthRequest, requireAdmin, requireAuth } from './src/middleware/auth.ts';
import { getOrCreateUser, isBlogAdminUser } from './src/db/users.ts';
import {
  deleteDiaryForUser,
  getDiaryPhotoBinaryForUser,
  getDiaryPhotosListForUser,
  getPublicBlogOwnerUserId,
  getServerDiaryMetaMapForUser,
  getSyncedDiariesForUser,
  includeAllDiariesInDistanceForUser,
  upsertDiaryMetadataForUser,
  upsertDiaryPhotoBinaryForUser,
  type UpsertDiaryInput,
} from './src/db/diaries.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveServerPort(): number {
  const portFlagIdx = process.argv.indexOf('--port');
  if (portFlagIdx >= 0 && process.argv[portFlagIdx + 1]) {
    const cliPort = Number(process.argv[portFlagIdx + 1]);
    if (Number.isFinite(cliPort) && cliPort > 0) return cliPort;
  }
  const envPort = Number(process.env.PORT);
  return Number.isFinite(envPort) && envPort > 0 ? envPort : 3000;
}

const PORT = resolveServerPort();
const MAX_PHOTO_BINARY_BYTES = 12 * 1024 * 1024; // 12MB safe upper bound for legacy & HD photos

function decodeHeaderValue(val: string | string[] | undefined): string {
  const raw = Array.isArray(val) ? val[0] : val;
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

async function startServer() {
  const app = express();

  app.use(express.json({ limit: '10mb' }));

  // Lightweight ping for connectivity diagnostics without hitting SQL pool
  app.get('/api/ping', (_req, res) => {
    res.json({ ok: true, backend: 'cloudsql' });
  });

  // Verify authenticated user's admin status against Cloud SQL blog owner record
  app.get('/api/auth/me', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user?.uid || '';
      const email = req.user?.email || '';
      const isAdmin = await isBlogAdminUser(uid, email);
      res.json({ uid, isAdmin });
    } catch (error: any) {
      console.error('GET /api/auth/me failed:', error);
      res.status(500).json({ error: error?.message || '관리자 권한 확인 실패' });
    }
  });

  // Public read-only: get compact metadata & photo signatures for published blog diaries
  app.get('/api/diaries/meta', async (_req, res) => {
    try {
      const ownerId = await getPublicBlogOwnerUserId();
      if (!ownerId) {
        res.json({ metaMap: {}, count: 0 });
        return;
      }
      const metaMap = await getServerDiaryMetaMapForUser(ownerId);
      res.json({ metaMap, count: Object.keys(metaMap).length });
    } catch (error: any) {
      console.error('GET /api/diaries/meta failed:', error);
      res.status(500).json({ error: error?.message || '서버 메타데이터 조회 실패' });
    }
  });

  // Public read-only: sync missing/updated diaries (returns diary data + cover thumbnails; HD photos fetched lazily)
  app.get('/api/diaries/sync', async (req, res) => {
    try {
      const ownerId = await getPublicBlogOwnerUserId();
      if (!ownerId) {
        res.json({ diaries: [] });
        return;
      }
      const sinceParam = typeof req.query.since === 'string' ? Number(req.query.since) : undefined;
      const idsParam =
        typeof req.query.ids === 'string' && req.query.ids.trim()
          ? req.query.ids
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined;

      const diaries = await getSyncedDiariesForUser(ownerId, {
        sinceMs: Number.isFinite(sinceParam) && (sinceParam as number) > 0 ? sinceParam : undefined,
        targetIds: idsParam,
      });

      res.json({ diaries });
    } catch (error: any) {
      console.error('GET /api/diaries/sync failed:', error);
      res.status(500).json({ error: error?.message || '일기 동기화 실패' });
    }
  });

  // Admin-only: include all server diaries in cumulative distance
  app.post('/api/diaries/include-all-distance', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const uid = req.user?.uid;
      if (!uid) {
        res.status(401).json({ error: '인증 정보가 없습니다.' });
        return;
      }
      const dbUser = await getOrCreateUser(uid, req.user?.email || '');
      const result = await includeAllDiariesInDistanceForUser(dbUser.id);
      res.json({ ok: true, ...result });
    } catch (error: any) {
      console.error('POST /api/diaries/include-all-distance failed:', error);
      res.status(500).json({ error: error?.message || '누적거리 포함 일괄 업데이트 실패' });
    }
  });

  // Admin-only: upsert diary text/location/photo metadata; returns missingPhotoIds requiring binary upload
  app.put('/api/diaries/:diaryId', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const uid = req.user?.uid;
      if (!uid) {
        res.status(401).json({ error: '인증 정보가 없습니다.' });
        return;
      }
      const diaryId = String(req.params.diaryId || '').trim();
      if (!diaryId || diaryId.length > 128) {
        res.status(400).json({ error: '유효하지 않은 일기 ID입니다.' });
        return;
      }

      const dbUser = await getOrCreateUser(uid, req.user?.email || '');
      const body = req.body as Omit<UpsertDiaryInput, 'id'>;
      const result = await upsertDiaryMetadataForUser(dbUser.id, {
        ...body,
        id: diaryId,
        photos: Array.isArray(body?.photos) ? body.photos : [],
      });

      res.json(result);
    } catch (error: any) {
      console.error('PUT /api/diaries/:diaryId failed:', error);
      const status = error?.message === '다른 사용자의 일기를 수정할 수 없습니다.' ? 403 : 500;
      res.status(status).json({ error: error?.message || '일기 저장 실패' });
    }
  });

  // Admin-only: upload a single photo as raw binary bytes
  app.put(
    '/api/diaries/:diaryId/photos/:photoId',
    requireAuth,
    requireAdmin,
    express.raw({ type: ['image/*', 'application/octet-stream'], limit: MAX_PHOTO_BINARY_BYTES }),
    async (req: AuthRequest, res) => {
      try {
        const uid = req.user?.uid;
        if (!uid) {
          res.status(401).json({ error: '인증 정보가 없습니다.' });
          return;
        }
        const diaryId = String(req.params.diaryId || '').trim();
        const photoId = String(req.params.photoId || '').trim();
        if (!diaryId || !photoId) {
          res.status(400).json({ error: '유효하지 않은 일기 또는 사진 ID입니다.' });
          return;
        }

        const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        if (buffer.length === 0) {
          res.status(400).json({ error: '업로드할 사진 데이터가 비어 있습니다.' });
          return;
        }
        if (buffer.length > MAX_PHOTO_BINARY_BYTES) {
          res.status(413).json({ error: '사진 크기가 허용 한도를 초과했습니다.' });
          return;
        }

        const dbUser = await getOrCreateUser(uid, req.user?.email || '');
        const orderIndex = Number(req.headers['x-photo-order']) || 0;
        const caption = decodeHeaderValue(req.headers['x-photo-caption']);
        const timestamp = decodeHeaderValue(req.headers['x-photo-timestamp']);
        const isCover = req.headers['x-photo-cover'] === 'true';
        const mimeType = String(req.headers['content-type'] || 'image/jpeg').split(';')[0].trim();
        const contentSig = decodeHeaderValue(req.headers['x-photo-sig']);

        const fullSig = await upsertDiaryPhotoBinaryForUser(
          dbUser.id,
          diaryId,
          photoId,
          {
            orderIndex,
            caption,
            timestamp,
            isCover,
            mimeType,
            contentSig,
          },
          buffer
        );

        res.json({ ok: true, photoId, fullSig, byteSize: buffer.length });
      } catch (error: any) {
        console.error('PUT /api/diaries/:diaryId/photos/:photoId failed:', error);
        const status = error?.message === '일기를 찾을 수 없거나 권한이 없습니다.' ? 404 : 500;
        res.status(status).json({ error: error?.message || '사진 업로드 실패' });
      }
    }
  );

  // Public read-only: list photo metadata for a single diary prior to lazy binary hydration
  app.get('/api/diaries/:diaryId/photos', async (req, res) => {
    try {
      const ownerId = await getPublicBlogOwnerUserId();
      if (!ownerId) {
        res.json({ photos: [] });
        return;
      }
      const photos = await getDiaryPhotosListForUser(ownerId, String(req.params.diaryId || ''));
      res.json({ photos });
    } catch (error: any) {
      console.error('GET /api/diaries/:diaryId/photos failed:', error);
      res.status(500).json({ error: error?.message || '사진 목록 조회 실패' });
    }
  });

  // Public read-only: stream a single binary photo from Cloud SQL bytea column
  app.get('/api/diaries/:diaryId/photos/:photoId/binary', async (req, res) => {
    try {
      const ownerId = await getPublicBlogOwnerUserId();
      if (!ownerId) {
        res.status(404).json({ error: '사진을 찾을 수 없습니다.' });
        return;
      }
      const photo = await getDiaryPhotoBinaryForUser(
        ownerId,
        String(req.params.diaryId || ''),
        String(req.params.photoId || '')
      );
      if (!photo) {
        res.status(404).json({ error: '사진을 찾을 수 없습니다.' });
        return;
      }
      if (photo.externalUrl) {
        res.json({ externalUrl: photo.externalUrl });
        return;
      }
      if (!photo.imageData) {
        res.status(404).json({ error: '저장된 이미지 데이터가 없습니다.' });
        return;
      }
      const isThumb = req.query.thumb === '1' || req.query.thumb === 'true';
      if (isThumb) {
        try {
          const { default: sharp } = await import('sharp');
          const thumbBuf = await sharp(photo.imageData)
            .rotate()
            .resize({ width: 420, height: 420, fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 72 })
            .toBuffer();
          res.setHeader('Content-Type', 'image/jpeg');
          res.setHeader('Cache-Control', 'public, max-age=86400');
          res.send(thumbBuf);
          return;
        } catch (thumbErr) {
          console.warn('Thumbnail generation fallback to full binary:', thumbErr);
        }
      }
      res.setHeader('Content-Type', photo.mimeType || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(photo.imageData);
    } catch (error: any) {
      console.error('GET /api/diaries/:diaryId/photos/:photoId/binary failed:', error);
      res.status(500).json({ error: error?.message || '사진 바이너리 조회 실패' });
    }
  });

  // Admin-only: delete a diary (and cascade-delete its photos)
  app.delete('/api/diaries/:diaryId', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const uid = req.user?.uid;
      if (!uid) {
        res.status(401).json({ error: '인증 정보가 없습니다.' });
        return;
      }
      const dbUser = await getOrCreateUser(uid, req.user?.email || '');
      const deleted = await deleteDiaryForUser(dbUser.id, String(req.params.diaryId || ''));
      res.json({ ok: true, deleted });
    } catch (error: any) {
      console.error('DELETE /api/diaries/:diaryId failed:', error);
      res.status(500).json({ error: error?.message || '일기 삭제 실패' });
    }
  });

  const distDir = path.resolve(__dirname, 'dist');
  const hasBuiltDist = fs.existsSync(path.join(distDir, 'index.html'));
  const isDevServer =
    process.env.NODE_ENV !== 'production' &&
    process.env.npm_lifecycle_event !== 'start' &&
    (process.env.npm_lifecycle_event === 'dev' ||
      process.argv.includes('--port') ||
      !hasBuiltDist);

  if (isDevServer) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        watch: null,
      },
      appType: 'spa',
    });
    app.get('/@vite/client', async (_req, res, next) => {
      try {
        const result = await vite.transformRequest('/@vite/client');
        if (!result?.code) {
          next();
          return;
        }
        const patchedCode = result.code
          .replace(
            'transport.connect(createHMRHandler(handleMessage));',
            '/* HMR WebSocket disabled in dev middleware */'
          )
          .replace(/throw new Error\(["']send was called before connect["']\);/g, 'return;');
        res.setHeader('Content-Type', 'application/javascript');
        res.setHeader('Cache-Control', 'no-cache');
        res.send(patchedCode);
      } catch {
        next();
      }
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api/')) {
        res.status(404).json({ error: 'Not Found' });
        return;
      }
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    const fallbackPort = Number(process.env.DEFAULT_APP_PORT) || 3000;
    if (
      err.code === 'EADDRINUSE' &&
      process.env.NGINX_PORT &&
      String(PORT) === String(process.env.NGINX_PORT) &&
      fallbackPort !== PORT
    ) {
      console.warn(`Port ${PORT} is used by nginx; falling back to port ${fallbackPort}`);
      app.listen(fallbackPort, '0.0.0.0', () => {
        console.log(`Server listening on http://0.0.0.0:${fallbackPort}`);
      });
      return;
    }
    console.error('Server listen error:', err);
    process.exit(1);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
