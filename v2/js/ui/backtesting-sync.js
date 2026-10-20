import { onSyncChange, getSyncSnapshot, syncNow } from '../services/sync-engine.js';

// Refresh incoming backtests after sync without repainting an editor in progress.
export function bindBacktestingSync(getRoute, refresh) {
  let lastRenderedSync = null, disposed = false;
  const isViewer = () => {
    const route = getRoute();
    return route.name === 'backtesting' || (route.name === 'trade' &&
      route.query?.from === 'backtesting' && !route.rest.includes('/'));
  };
  const unsubscribe = onSyncChange(async () => {
    try {
      const { state } = await getSyncSnapshot();
      if (disposed || state.status === 'syncing' || !state.lastSyncAt ||
        state.lastSyncAt === lastRenderedSync || !isViewer()) return;
      lastRenderedSync = state.lastSyncAt;
      await refresh();
    } catch (_) { /* Sync status remains available in Sistema. */ }
  });
  const focus = () => {
    if (isViewer()) syncNow({ reason: 'backtesting-focus' }).catch(() => {});
  };
  window.addEventListener('focus', focus);
  return () => { disposed = true; unsubscribe(); window.removeEventListener('focus', focus); };
}
