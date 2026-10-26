export function isCloudSyncAuthorized(provided: string | null, expected: string) {
  if (!provided || !expected) return false;
  const length = Math.max(provided.length, expected.length);
  let difference = provided.length ^ expected.length;
  for (let index = 0; index < length; index++) difference |= (provided.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  return difference === 0;
}
