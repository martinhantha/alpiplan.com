// Android shows only one runtime permission dialog at a time and silently drops
// concurrent requests, so every native permission prompt must go through here.
let tail: Promise<unknown> = Promise.resolve();

export function queueNativePermissionRequest<T>(task: () => Promise<T>): Promise<T> {
  const run = tail.then(task, task);
  tail = run.catch(() => undefined);
  return run;
}
