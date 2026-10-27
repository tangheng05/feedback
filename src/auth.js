import { getAdminCache, setAdminCache, now } from './db.js';
import * as tg from './telegram.js';

const ADMIN_CACHE_TTL = 5 * 60; // seconds

// Cached briefly: a just-demoted admin keeps access for up to 5 minutes.
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
    // Fail closed, and don't cache a transient failure.
    return false;
  }
}
