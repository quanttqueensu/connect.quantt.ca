import { describe, expect, it } from "vitest";
import { isPackagePdfPath, isPhotoPath, isSnapshotPath } from "../lib/storage-paths";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";

describe("canonical Storage object paths", () => {
  it("keeps generated and safe legacy keys", () => {
    expect(isPackagePdfPath(`${owner}/packages/${other}/resume.pdf`, owner)).toBe(true);
    expect(isPackagePdfPath(`${owner}/packages/x/cover.pdf`, owner)).toBe(true);
    expect(isPhotoPath(`${owner}/photo.webp`, owner)).toBe(true);
    expect(isPhotoPath(`${owner}/avatar.jpg`, owner)).toBe(true);
    expect(isSnapshotPath(`snapshots/${owner}/resume.pdf`, owner)).toBe(true);
  });

  it.each([
    `../${other}/packages/x/resume.pdf`,
    `%2e%2e/${other}/packages/x/resume.pdf`,
    `packages/%2e%2e/resume.pdf`,
    `packages/x%2f..%2f..%2f${other}/resume.pdf`,
    `packages/x\\..\\..\\${other}/resume.pdf`,
    `packages//resume.pdf`,
    `packages/./resume.pdf`,
    `packages/../resume.pdf`,
    `packages/x/resume.pdf?download=1`,
    `packages/x/resume.pdf#ignored`,
    `packages/x/resume.pdf\n`,
    `packages/x/resume.pdf\u0000`,
  ])("refuses an unsafe package key: %s", (suffix) => {
    expect(isPackagePdfPath(`${owner}/${suffix}`, owner)).toBe(false);
  });

  it("rejects cross-owner, cross-bucket and sibling snapshot paths", () => {
    expect(isPackagePdfPath(`${other}/packages/x/resume.pdf`, owner)).toBe(false);
    for (const path of [`${owner}/../../resumes/${other}/resume.pdf`, `${owner}/photo.jpg?x`, `${owner}/photo.jpg\n`]) {
      expect(isPhotoPath(path, owner)).toBe(false);
    }
    for (const path of [`snapshots/${owner}/..`, `snapshots/${owner}/../${other}/resume.pdf`, `snapshots/${other}/resume.pdf`]) {
      expect(isSnapshotPath(path, owner)).toBe(false);
    }
  });
});
