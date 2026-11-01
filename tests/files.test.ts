import { describe, expect, it } from "vitest";
import {
  assertPdf,
  csvCell,
  imageContentType,
  imageKind,
  MAX_IMAGE_BYTES,
  MAX_PDF_BYTES,
  memberPhotoSrc,
  PDF_CONTENT_TYPE,
} from "../lib/files";
import { DENIAL_MESSAGES } from "../lib/denials";

function file(bytes: Uint8Array | string, name: string, type: string): File {
  if (typeof bytes === "string") return new File([bytes], name, { type });
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new File([copy], name, { type });
}

function jpegBytes() {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
}

function pngBytes() {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00]);
}

function webpBytes() {
  const b = new Uint8Array(12);
  b.set(new TextEncoder().encode("RIFF"), 0);
  b.set(new TextEncoder().encode("WEBP"), 8);
  return b;
}

function pdfBytes() {
  return new TextEncoder().encode("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
}

describe("imageKind", () => {
  it("accepts jpeg, png, and webp from bytes even when File.type is wrong or empty", async () => {
    expect(await imageKind(file(jpegBytes(), "a.bin", ""))).toBe("jpeg");
    expect(await imageKind(file(jpegBytes(), "a.gif", "image/gif"))).toBe("jpeg");
    expect(await imageKind(file(pngBytes(), "a.png", "application/octet-stream"))).toBe("png");
    expect(await imageKind(file(webpBytes(), "a.webp", "text/plain"))).toBe("webp");
  });

  it("rejects HTML labelled as jpeg", async () => {
    expect(
      await imageKind(file("<html><script>alert(1)</script>", "photo.jpg", "image/jpeg")),
    ).toBeNull();
  });

  it("rejects SVG labelled as png", async () => {
    expect(
      await imageKind(
        file("<svg xmlns='http://www.w3.org/2000/svg'></svg>", "photo.png", "image/png"),
      ),
    ).toBeNull();
  });

  it("rejects gif, ico, bmp, xml, and empty files", async () => {
    expect(await imageKind(file("GIF89a", "a.gif", "image/gif"))).toBeNull();
    expect(await imageKind(file(new Uint8Array([0x00, 0x00, 0x01, 0x00]), "a.ico", "image/x-icon"))).toBeNull();
    expect(await imageKind(file("BM", "a.bmp", "image/bmp"))).toBeNull();
    expect(await imageKind(file("<?xml version='1.0'?>", "a.xml", "image/jpeg"))).toBeNull();
    expect(await imageKind(file(new Uint8Array(), "empty.jpg", "image/jpeg"))).toBeNull();
  });

  it("rejects oversized images", async () => {
    const buf = new Uint8Array(MAX_IMAGE_BYTES + 1);
    buf.set(jpegBytes());
    expect(await imageKind(file(buf, "huge.jpg", "image/jpeg"))).toBeNull();
  });

  it("pins upload Content-Type from detected kind, never File.type", async () => {
    const kind = await imageKind(file(jpegBytes(), "x.jpg", "text/html"));
    expect(kind).toBe("jpeg");
    expect(imageContentType(kind!)).toBe("image/jpeg");
    expect(imageContentType(kind!)).not.toBe("text/html");
  });
});

describe("assertPdf", () => {
  it("accepts a real PDF whose File.type is empty", async () => {
    await expect(assertPdf(file(pdfBytes(), "resume.pdf", ""), "Resume")).resolves.toBeUndefined();
  });

  it("accepts a real PDF even when the client claims the wrong type", async () => {
    await expect(
      assertPdf(file(pdfBytes(), "resume.pdf", "application/octet-stream"), "Resume"),
    ).resolves.toBeUndefined();
  });

  it("rejects HTML labelled as PDF", async () => {
    await expect(
      assertPdf(file("<html><body>not a pdf</body>", "cover.pdf", "application/pdf"), "Cover"),
    ).rejects.toThrow("Cover must be a PDF");
  });

  it("rejects HTML-first polyglots where %PDF- is not at offset 0", async () => {
    await expect(
      assertPdf(file("<html>%PDF-1.4\n", "polyglot.pdf", "application/pdf"), "Resume"),
    ).rejects.toThrow("Resume must be a PDF");
  });

  it("rejects ZIP and OLE payloads labelled as PDF", async () => {
    await expect(
      assertPdf(file(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), "x.pdf", "application/pdf"), "Resume"),
    ).rejects.toThrow("Resume must be a PDF");
    await expect(
      assertPdf(
        file(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), "x.pdf", "application/pdf"),
        "Resume",
      ),
    ).rejects.toThrow("Resume must be a PDF");
  });

  it("rejects EXE, WASM, PHP, and shell scripts", async () => {
    await expect(
      assertPdf(file(new Uint8Array([0x4d, 0x5a, 0x90, 0x00]), "x.pdf", "application/pdf"), "Resume"),
    ).rejects.toThrow();
    await expect(
      assertPdf(file(new Uint8Array([0x00, 0x61, 0x73, 0x6d]), "x.pdf", "application/pdf"), "Resume"),
    ).rejects.toThrow();
    await expect(assertPdf(file("<?php echo 1;", "x.pdf", "application/pdf"), "Resume")).rejects.toThrow();
    await expect(assertPdf(file("#!/bin/sh\necho hi\n", "x.pdf", "application/pdf"), "Resume")).rejects.toThrow();
  });

  it("rejects empty and oversized PDFs", async () => {
    await expect(assertPdf(file(new Uint8Array(), "x.pdf", "application/pdf"), "Resume")).rejects.toThrow(
      "Resume must be a PDF",
    );
    const buf = new Uint8Array(MAX_PDF_BYTES + 1);
    buf.set(pdfBytes());
    await expect(assertPdf(file(buf, "huge.pdf", "application/pdf"), "Resume")).rejects.toThrow(
      "Resume must be under 5MB",
    );
  });

  it("never uses the client MIME as the stored type", () => {
    expect(PDF_CONTENT_TYPE).toBe("application/pdf");
  });
});

describe("csvCell", () => {
  it("neutralizes formula injection prefixes", () => {
    expect(csvCell("=1+1")).toBe(`"'=1+1"`);
    expect(csvCell("+cmd")).toBe(`"'+cmd"`);
    expect(csvCell("-2+5")).toBe(`"'-2+5"`);
    expect(csvCell("@SUM(A1)")).toBe(`"'@SUM(A1)"`);
    expect(csvCell("\t=1+1")).toBe(`"'\t=1+1"`);
    expect(csvCell("\r=1+1")).toBe(`"'\r=1+1"`);
  });

  it("still quotes commas and quotes", () => {
    expect(csvCell("Doe, Jane")).toBe(`"Doe, Jane"`);
    expect(csvCell('say "hi"')).toBe(`"say ""hi"""`);
  });

  it("leaves ordinary values alone", () => {
    expect(csvCell("Ada Lovelace")).toBe("Ada Lovelace");
    expect(csvCell(2027)).toBe("2027");
    expect(csvCell(null)).toBe("");
  });
});

describe("memberPhotoSrc", () => {
  it("returns a cookie-gated app route instead of a Storage URL", () => {
    expect(memberPhotoSrc("abc", "abc/photo.jpg")).toBe("/members/abc/photo");
    expect(memberPhotoSrc("abc", null)).toBeNull();
  });
});

describe("file-related denial codes", () => {
  it("maps apply/package file failures to copy, not driver text", () => {
    expect(DENIAL_MESSAGES.application_not_open).toMatch(/not taking applications through Connect/i);
    expect(DENIAL_MESSAGES.application_resume_required).toMatch(/resume/i);
    expect(DENIAL_MESSAGES.package_file_invalid).toMatch(/PDF/i);
    expect(DENIAL_MESSAGES.application_submit_failed).toMatch(/could not be submitted/i);
  });
});
