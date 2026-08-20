import { getAdminCache, setAdminCache, now } from './db.js';
import * as tg from './telegram.js';

const ADMIN_CACHE_TTL = 5 * 60; // seconds

/**
 * Only group admins may run commands or press status buttons.
 *
 * The result is cached briefly because every action would otherwise cost an
 * extra Telegram round-trip, and admin lists change rarely. A just-demoted
 * admin keeps access for up to 5 minutes, which is an acceptable trade here.
 */
export async function isAdmin(userId) {
  if (!userId) return false;

  const cached = getAdminCache(userId);
  if (cached && now() - cached.checked_at < ADMIN_CACHE_TTL) {
    return Boolean(cached.is_admin);
  }

  try {
    const member = await tg.getChatMember(userId);
    const ok = member.status === 'creator' || member.status === 'administrator';
    setAdminCache(userId, ok);
    return ok;
  } catch (err) {
    console.error('[auth] getChatMember failed:', err.message);
    // Fail closed, and do not cache — a Telegram hiccup must never hand out
    // admin rights, nor lock out a real admin for the whole TTL.
    return false;
  }
}
