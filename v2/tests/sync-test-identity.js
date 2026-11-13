import './test-safety.js';
import { setAuthClient } from '../js/services/auth.js';
import { ensureDeviceState, prepareSyncResume, resumeSync } from '../js/services/sync-engine.js';
import { bindSyncOwner } from '../js/services/sync-owner.js';
export async function testIdentity(userId = '11111111-1111-4111-8111-111111111111') {
  localStorage.setItem('journalV2.supabaseUrl', 'https://example.supabase.co');
  localStorage.setItem('journalV2.supabasePublishableKey', 'pub-test-key');
  const session = { user: { id: userId, email: 'synthetic@example.test' }, access_token: 'synthetic' };
  setAuthClient({ auth: { getSession: async () => ({ data: { session }, error: null }) } });
  await ensureDeviceState();
  await bindSyncOwner();
  await resumeSync(await prepareSyncResume());
}
