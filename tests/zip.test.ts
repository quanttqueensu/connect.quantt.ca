import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildZip, crc32, safeFileName } from "../lib/zip";

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});

describe("buildZip", () => {
  it("writes an archive that unzip tools read back byte for byte", () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3, 255]);
    const zip = buildZip([
      { name: "index.csv", data: new TextEncoder().encode("name\nJane\n") },
      { name: "Jane Doe.pdf", data: pdf },
    ]);
    expect(new DataView(zip.buffer).getUint32(0, true)).toBe(0x04034b50);
    const dir = mkdtempSync(join(tmpdir(), "zip-"));
    const file = join(dir, "t.zip");
    writeFileSync(file, zip);
    const out = execFileSync("python3", [
      "-I", "-c",
      "import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(z.namelist());print(list(z.read('Jane Doe.pdf')))",
      file,
    ]).toString();
    expect(out).toContain("['index.csv', 'Jane Doe.pdf']");
    expect(out).toContain(JSON.stringify(Array.from(pdf)).replaceAll(",", ", "));
  });
});

describe("safeFileName", () => {
  it("keeps names portable", () => {
    expect(safeFileName("Zoë O'Neil/../x", "Member")).toBe("Zoe ONeil..x");
    expect(safeFileName("  ", "Member")).toBe("Member");
  });
});
