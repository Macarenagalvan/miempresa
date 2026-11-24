let applying = 0;
let muted = false;

export function beginApply() {
  applying += 1;
}

export function endApply() {
  applying = Math.max(0, applying - 1);
}

export function isApplying() {
  return applying > 0 || muted;
}

export function muteDirtyTracking() {
  muted = true;
}

export function unmuteDirtyTracking() {
  muted = false;
}

export function resetApplyFlag() {
  applying = 0;
  muted = false;
}

export async function withApplyLock(fn) {
  beginApply();
  try {
    return await fn();
  } finally {
    endApply();
  }
}
