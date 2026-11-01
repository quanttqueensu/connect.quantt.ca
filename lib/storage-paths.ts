// Object keys reach fetch URLs in the Storage SDK. Accept only canonical keys;
// checking a prefix before URL normalization does not establish ownership.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isPackagePdfPath(path: unknown, memberId: string): path is string {
  return memberId.length === 36 && UUID.test(memberId) && typeof path === "string" && !/[^\x21-\x7e]/.test(path) &&
    path.startsWith(`${memberId}/packages/`) &&
    /^[A-Za-z0-9_-]+\/(resume|cover)\.pdf$/.test(path.slice(memberId.length + 10));
}
