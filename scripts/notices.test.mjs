import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { selectLicense, sha256, verifyManifest } from "./notices.mjs";

const allowed = ["MIT", "Apache-2.0", "Unicode-3.0", "MPL-2.0"];

test("license alternatives preserve the required conjunction", () => {
  assert.deepEqual(selectLicense("(MIT OR Apache-2.0) AND Unicode-3.0", allowed),
    ["MIT", "Unicode-3.0"]);
  assert.deepEqual(selectLicense("MIT AND Apache-2.0", allowed), ["Apache-2.0", "MIT"]);
});

test("DOMPurify's selected Apache option is valid and an invented option fails", () => {
  assert.deepEqual(selectLicense("(MPL-2.0 OR Apache-2.0)", allowed, "Apache-2.0"), ["Apache-2.0"]);
  assert.throws(() => selectLicense("(MPL-2.0 OR Apache-2.0)", allowed, "MIT"), /invalid/);
});

test("new license terms and unreviewed legacy syntax stop generation", () => {
  assert.throws(() => selectLicense("GPL-3.0-only", allowed), /Unreviewed/);
  assert.throws(() => selectLicense("MIT AND GPL-3.0-only", allowed), /Unreviewed/);
  assert.throws(() => selectLicense("MIT/Apache-2.0", allowed), /Unsupported/);
  assert.throws(() => selectLicense("MIT OR", allowed), /Invalid/);
  assert.deepEqual(selectLicense("MIT/Apache-2.0", allowed, undefined,
    { "MIT/Apache-2.0": "MIT OR Apache-2.0" }), ["MIT"]);
});

test("an unknown exception is not silently dropped from its license", () => {
  assert.throws(() => selectLicense("Apache-2.0 WITH Unknown-exception", allowed), /Unreviewed/);
  assert.deepEqual(selectLicense("Apache-2.0 WITH Unknown-exception OR MIT", allowed), ["MIT"]);
});

test("missing or changed locked inputs and source archives fail verification", () => {
  const base = mkdtempSync(join(tmpdir(), "justcompare-notice-test-"));
  try {
    mkdirSync(join(base, "third_party/sources"), { recursive: true });
    writeFileSync(join(base, "lockfile"), "locked dependencies");
    writeFileSync(join(base, "third_party/sources/source.crate"), "exact source");
    writeFileSync(join(base, "third_party/manifest.json"), JSON.stringify({
      inputs: { lockfile: sha256("locked dependencies") },
      files: { "third_party/sources/source.crate": sha256("exact source") },
    }));
    verifyManifest(base);
    writeFileSync(join(base, "lockfile"), "updated dependencies");
    assert.throws(() => verifyManifest(base), /Stale or changed/);
    writeFileSync(join(base, "lockfile"), "locked dependencies");
    writeFileSync(join(base, "third_party/sources/source.crate"), "different source");
    assert.throws(() => verifyManifest(base), /Stale or changed/);
    rmSync(join(base, "third_party/sources/source.crate"));
    assert.throws(() => verifyManifest(base), /Stale or changed/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
