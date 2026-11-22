import { asc } from 'drizzle-orm';
import { db } from './index.ts';
import { users } from './schema.ts';

export async function isBlogAdminUser(uid: string, email?: string): Promise<boolean> {
  const envAdminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const normalizedEmail = (email || '').trim().toLowerCase();

  if (envAdminEmail) {
    return Boolean(normalizedEmail && normalizedEmail === envAdminEmail);
  }

  const ownerRows = await db
    .select({ id: users.id, uid: users.uid, email: users.email })
    .from(users)
    .orderBy(asc(users.id))
    .limit(1);

  if (ownerRows.length === 0) {
    return Boolean(uid);
  }

  const owner = ownerRows[0];
  if (owner.uid && uid && owner.uid === uid) {
    return true;
  }
  if (owner.email && normalizedEmail && owner.email.toLowerCase() === normalizedEmail) {
    return true;
  }
  return false;
}

export async function getOrCreateUser(uid: string, email: string) {
  try {
    const result = await db
      .insert(users)
      .values({
        uid,
        email: email || `${uid}@firebase.user`,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email: email || `${uid}@firebase.user`,
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Failed to upsert user record:', error);
    throw new Error('사용자 계정 동기화에 실패했습니다.', { cause: error });
  }
}
