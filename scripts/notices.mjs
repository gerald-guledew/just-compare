import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const policyPath = "scripts/notices-policy.json";
const policy = JSON.parse(readFileSync(join(root, policyPath), "utf8"));
const generatedPaths = [
  "third_party/inventory.json",
  "third_party/notices.txt",
  "third_party/index.html",
];
const manifestPath = "third_party/manifest.json";

export function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function portable(path) {
  return path.split(sep).join("/");
}

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function commandJson(command, args) {
  // The .cmd launcher needs a shell only on Windows. Arguments here are
  // constant strings or reviewed target triples, never user content.
  const executable = process.platform === "win32" && command === "pnpm"
    ? "pnpm.cmd"
    : command;
  return JSON.parse(execFileSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === "win32" && command === "pnpm",
  }));
}

export function selectLicense(expression, preference, explicit, legacy = {}) {
  const normalized = legacy[expression] ?? expression;
  if (typeof normalized !== "string" || !normalized.trim()) {
    throw new Error("A dependency has no declared license");
  }
  const tokens = normalized.match(/\(|\)|[A-Za-z0-9.+-]+/g) ?? [];
  if (tokens.join("") !== normalized.replace(/\s/g, "")) {
    throw new Error(`Unsupported license expression: ${expression}`);
  }
  let index = 0;
  function atom() {
    if (tokens[index] === "(") {
      index++;
      const result = alternatives();
      if (tokens[index++] !== ")") throw new Error(`Invalid license: ${expression}`);
      return result;
    }
    let identifier = tokens[index++];
    if (!identifier || ["AND", "OR", "WITH", ")"].includes(identifier)) {
      throw new Error(`Invalid license: ${expression}`);
    }
    if (tokens[index] === "WITH") {
      index++;
      identifier += ` WITH ${tokens[index++]}`;
    }
    return [[identifier]];
  }
  function conjunctions() {
    let result = atom();
    while (tokens[index] === "AND") {
      index++;
      const right = atom();
      result = result.flatMap((left) => right.map((item) => [...left, ...item]));
    }
    return result;
  }
  function alternatives() {
    let result = conjunctions();
    while (tokens[index] === "OR") {
      index++;
      result = [...result, ...conjunctions()];
    }
    return result;
  }
  const choices = alternatives();
  if (index !== tokens.length) throw new Error(`Invalid license: ${expression}`);
  const permitted = choices.filter((choice) => choice.every((id) => preference.includes(id)));
  if (!permitted.length) throw new Error(`Unreviewed license: ${expression}`);
  if (explicit) {
    const wanted = explicit.split(" AND ").sort().join(" AND ");
    const match = permitted.find((choice) => [...choice].sort().join(" AND ") === wanted);
    if (!match) throw new Error(`License selection ${explicit} is invalid for ${expression}`);
    return [...new Set(match)].sort();
  }
  permitted.sort((a, b) => {
    const aRanks = a.map((id) => preference.indexOf(id)).sort((a, b) => b - a);
    const bRanks = b.map((id) => preference.indexOf(id)).sort((a, b) => b - a);
    for (let rank = 0; rank < Math.max(aRanks.length, bRanks.length); rank++) {
      const difference = (aRanks[rank] ?? -1) - (bRanks[rank] ?? -1);
      if (difference) return difference;
    }
    return a.join(" AND ").localeCompare(b.join(" AND "), "en");
  });
  return [...new Set(permitted[0])].sort();
}

function selectedLicense(id, expression) {
  return selectLicense(expression, policy.licensePreference,
    policy.licenseSelections[id], policy.legacyLicenseExpressions);
}

function walkFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(path) : entry.isFile() ? [path] : [];
  }).sort();
}

function licenseFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!/^(licen[sc]e|copying|copyright|notice|third.?party)/i.test(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isFile()) files.push(path);
    else if (entry.isDirectory()) files.push(...walkFiles(path));
  }
  return files.sort().map((path) => ({
    name: portable(relative(directory, path)),
    text: readFileSync(path, "utf8"),
  }));
}

function supplementaryFiles(id, catalog) {
  return (catalog.packages[id] ?? []).map((entry) => {
    const text = readFileSync(join(root, entry.path), "utf8");
    if (sha256(text) !== entry.sha256) throw new Error(`Changed supplemental license: ${entry.path}`);
    return { name: entry.path, text, source: entry.source };
  });
}

function makeRecord({ id, name, version, declaredLicense, source, files, targets, scope, catalog }) {
  const selectedLicenses = selectedLicense(id, declaredLicense);
  const notices = [...files, ...supplementaryFiles(id, catalog)];
  if (!notices.length) throw new Error(`Missing copyright/license notice for ${id}`);
  for (const license of selectedLicenses) {
    if (!existsSync(join(root, "third_party/licenses", `${license}.txt`))) {
      throw new Error(`Missing full ${license} license text for ${id}`);
    }
  }
  return {
    id, name, version, declaredLicense, selectedLicenses, source,
    targets: [...targets].sort(), scope,
    notices: notices.map(({ name, text, source }) => ({ name, sha256: sha256(text), ...(source ? { source } : {}) })),
    _texts: notices,
  };
}

function frontendRecords(catalog) {
  const project = readJson("package.json");
  const classified = [...policy.frontendRuntimeRoots, ...policy.frontendBuildOnlyRoots].sort();
  if (JSON.stringify(Object.keys(project.dependencies).sort()) !== JSON.stringify(classified)) {
    throw new Error("Classify every direct frontend dependency in scripts/notices-policy.json");
  }
  const graph = commandJson("pnpm", ["list", "--lockfile-only", "--prod", "--depth", "Infinity", "--json"])[0];
  const allPackages = new Map();
  function register(name, item) {
    const id = `npm:${name}@${item.version}`;
    if (!allPackages.has(id)) allPackages.set(id, { name, ...item, children: new Set() });
    for (const [dependencyName, dependency] of Object.entries(item.dependencies ?? {})) {
      allPackages.get(id).children.add(register(dependencyName, dependency));
    }
    return id;
  }
  for (const [name, item] of Object.entries(graph.dependencies ?? {})) register(name, item);
  const packages = new Map();
  const pending = [];
  for (const name of policy.frontendRuntimeRoots) {
    const item = graph.dependencies?.[name];
    if (!item) throw new Error(`Missing installed frontend dependency ${name}`);
    pending.push(`npm:${name}@${item.version}`);
  }
  while (pending.length) {
    const id = pending.pop();
    if (packages.has(id)) continue;
    const item = allPackages.get(id);
    if (!item?.path) throw new Error(`Missing installed path for ${id}`);
    packages.set(id, item);
    pending.push(...item.children);
  }
  return [...packages].map(([id, item]) => {
    const manifest = JSON.parse(readFileSync(join(item.path, "package.json"), "utf8"));
    if (manifest.name !== item.name || manifest.version !== item.version) {
      throw new Error(`Installed package identity differs for ${id}`);
    }
    return makeRecord({
      id, name: item.name, version: item.version, declaredLicense: manifest.license,
      source: item.resolved ?? `https://registry.npmjs.org/${item.name}/-/${item.name.split("/").at(-1)}-${item.version}.tgz`,
      files: licenseFiles(item.path), targets: policy.targets,
      scope: "Conservative frontend runtime dependency closure, including type-only dependencies",
      catalog,
    });
  });
}

function cargoRecords(catalog) {
  const lockedChecksums = new Map(readFileSync(join(root, "src-tauri/Cargo.lock"), "utf8")
    .split(/\n\[\[package\]\]\n/).flatMap((section) => {
      const name = section.match(/^name = "([^"]+)"$/m)?.[1];
      const version = section.match(/^version = "([^"]+)"$/m)?.[1];
      const checksum = section.match(/^checksum = "([a-f0-9]{64})"$/m)?.[1];
      return name && version && checksum ? [[`${name}@${version}`, checksum]] : [];
    }));
  const packages = new Map();
  for (const target of policy.targets) {
    const metadata = commandJson("cargo", [
      "metadata", "--manifest-path", "src-tauri/Cargo.toml", "--locked", "--offline",
      "--format-version", "1", "--filter-platform", target,
      "--features", policy.cargoFeatures.join(","),
    ]);
    const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
    const reachable = new Set();
    const pending = [metadata.resolve.root];
    while (pending.length) {
      const id = pending.pop();
      if (reachable.has(id)) continue;
      reachable.add(id);
      pending.push(...(nodes.get(id)?.deps ?? []).map((dependency) => dependency.pkg));
    }
    for (const item of metadata.packages) {
      if (!reachable.has(item.id)) continue;
      if (!item.source) {
        if (item.id === metadata.resolve.root && item.name === "justcompare") continue;
        throw new Error(`Review path/workspace dependency before distribution: ${item.name}`);
      }
      if (item.source !== "registry+https://github.com/rust-lang/crates.io-index") {
        throw new Error(`Review non-crates.io source before distribution: ${item.name}`);
      }
      const id = `cargo:${item.name}@${item.version}`;
      if (!packages.has(id)) packages.set(id, { ...item, targets: new Set() });
      packages.get(id).targets.add(target);
    }
  }
  return [...packages].map(([id, item]) => {
    const directory = dirname(item.manifest_path);
    const record = makeRecord({
      id, name: item.name, version: item.version, declaredLicense: item.license,
      source: `https://crates.io/api/v1/crates/${item.name}/${item.version}/download`,
      files: licenseFiles(directory), targets: item.targets,
      scope: "Conservative target dependency graph, including build and test dependencies",
      catalog,
    });
    record._directory = directory;
    if (record.selectedLicenses.includes("MPL-2.0")) {
      const archiveName = `${item.name}-${item.version}.crate`;
      const registry = dirname(directory);
      const archivePath = join(dirname(dirname(registry)), "cache", registry.split(sep).at(-1), archiveName);
      if (!existsSync(archivePath)) throw new Error(`Missing exact MPL source archive for ${id}; run cargo fetch --locked`);
      const bytes = readFileSync(archivePath);
      const lockedChecksum = lockedChecksums.get(`${item.name}@${item.version}`);
      if (!lockedChecksum || sha256(bytes) !== lockedChecksum) {
        throw new Error(`MPL source archive checksum differs from Cargo.lock for ${id}`);
      }
      record.correspondingSource = { path: `sources/${archiveName}`, sha256: lockedChecksum, modified: false };
      record._sourceBytes = bytes;
    }
    return record;
  });
}

function nativeRecords(catalog, records) {
  return (catalog.nativeComponents ?? []).map((component) => {
    const carrier = records.find((record) => record.id === component.carrier);
    if (!carrier?._directory) throw new Error(`Review changed native component carrier: ${component.carrier}`);
    for (const artifact of component.artifacts) {
      const path = join(carrier._directory, artifact.path);
      if (!existsSync(path) || sha256(readFileSync(path)) !== artifact.sha256) {
        throw new Error(`Review changed native component binary: ${component.id}/${artifact.path}`);
      }
    }
    const record = makeRecord({ ...component, files: [], catalog });
    record.carrier = component.carrier;
    record.artifacts = component.artifacts;
    record.sourcePackageSha256 = component.sourcePackageSha256;
    return record;
  });
}

function inputHashes() {
  const paths = [
    ".gitattributes", "LICENSE", "package.json", "pnpm-lock.yaml", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock",
    "pnpm-workspace.yaml", "scripts/notices.mjs", policyPath, "THIRD_PARTY_NOTICES.md",
    ...walkFiles(join(root, "patches")).map((path) => portable(relative(root, path))),
    ...walkFiles(join(root, "third_party/supplements")).map((path) => portable(relative(root, path))),
    ...walkFiles(join(root, "third_party/licenses")).map((path) => portable(relative(root, path))),
  ].sort();
  return Object.fromEntries(paths.map((path) => [path, sha256(readFileSync(join(root, path)))]));
}

function htmlEscape(text) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function generate() {
  const catalog = readJson("third_party/supplements/catalog.json");
  for (const [license, file] of Object.entries(catalog.licenseTexts)) {
    if (!existsSync(join(root, file.path)) || sha256(readFileSync(join(root, file.path))) !== file.sha256) {
      throw new Error(`Changed full license terms for ${license}: ${file.path}`);
    }
  }
  const records = [...frontendRecords(catalog), ...cargoRecords(catalog)];
  records.push(...nativeRecords(catalog, records));
  const asset = makeRecord({
    id: "asset:feather-icons@4.29.2", name: "Feather icons", version: "4.29.2", declaredLicense: "MIT",
    source: "https://github.com/feathericons/feather/tree/v4.29.2",
    files: [], targets: policy.targets, scope: "Inline folder, save and alert-triangle SVG geometry", catalog,
  });
  records.push(asset);
  records.sort((a, b) => a.id.localeCompare(b.id, "en"));
  const sourceArchives = new Map(records.filter((record) => record.correspondingSource)
    .map((record) => ["third_party/" + record.correspondingSource.path, record._sourceBytes]));
  const inputs = inputHashes();
  const inventory = {
    schemaVersion: 1,
    application: { name: "JustCompare", version: readJson("package.json").version, license: "MIT" },
    targets: policy.targets,
    cargoFeatures: policy.cargoFeatures,
    lockfiles: { javascript: inputs["pnpm-lock.yaml"], rust: inputs["src-tauri/Cargo.lock"] },
    scope: "Conservative source/dependency inventory, not a verified bill of materials for every installer. Build/test dependencies are included. Native system libraries and proprietary runtime redistribution must be verified per release.",
    packages: records.map(({ _texts, _sourceBytes, _directory, ...record }) => record),
  };
  const parts = [
    "JustCompare: third-party software notices", "",
    "The application source is MIT licensed. Dependencies and assets retain their own copyrights and licenses.",
    "This conservative inventory covers the configured desktop targets and includes build/test/type-only components.",
    "The selected SPDX licenses are recorded per package; additional upstream alternative license texts are retained.",
    "MPL source archives in sources/ are exact, unmodified crates.io Source Code Form distributions, verified against Cargo checksums.",
    "The Mozilla Public License applies to covered components and modifications to those files, not unrelated application files.",
    "Installer-specific native library/runtime obligations require a separate audit before binary publication.", "",
    "MONACO MODIFICATIONS", "",
    "monaco-editor 0.55.1 is patched in patches/monaco-editor@0.55.1.patch.",
    "Changes catch disposed-editor word-highlighter cancellation errors and import the reviewed DOMPurify 3.4.16 package instead of Monaco's vendored sanitizer.",
    "The original Microsoft copyright, MIT license and complete ThirdPartyNotices.txt are retained below.",
    "DOMPurify 3.4.16 is used under its Apache-2.0 option.", "",
  ];
  for (const record of records) {
    parts.push("=".repeat(78), record.id, `Source: ${record.source}`,
      `Declared: ${record.declaredLicense}`, `Selected: ${record.selectedLicenses.join(" AND ")}`,
      `Targets: ${record.targets.join(", ")}`, `Scope: ${record.scope}`);
    if (record.correspondingSource) parts.push(`Corresponding source: ${record.correspondingSource.path}`,
      `Source SHA-256: ${record.correspondingSource.sha256}`);
    for (const file of record._texts) parts.push("", `--- ${file.name} ---`, ...(file.source ? [`Source: ${file.source}`] : []), file.text.trimEnd());
    parts.push("");
  }
  parts.push("=".repeat(78), "FULL SELECTED LICENSE TERMS", "");
  for (const license of [...new Set(records.flatMap((record) => record.selectedLicenses))].sort()) {
    parts.push(`--- ${license} ---`, readFileSync(join(root, "third_party/licenses", `${license}.txt`), "utf8").trimEnd(), "");
  }
  const notices = parts.join("\n") + "\n";
  const sourceLinks = records.filter((record) => record.correspondingSource)
    .map((record) => `<li><a href="${htmlEscape(record.correspondingSource.path)}">${htmlEscape(record.name)} ${htmlEscape(record.version)} source archive</a> (SHA-256 ${record.correspondingSource.sha256})</li>`).join("\n");
  const html = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>JustCompare third-party licenses</title><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>body{font:16px system-ui,sans-serif;margin:2rem;max-width:90rem}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}li{overflow-wrap:anywhere;margin:.5rem 0}</style></head><body><h1>Third-party licenses</h1><p>These notices are available offline. <a href="notices.txt">Plain text notices</a> and <a href="inventory.json">versioned inventory</a>.</p><h2>MPL corresponding source</h2><p>The files below are gzip-compressed tar archives in Cargo's .crate format. They contain the exact unmodified Source Code Form supplied by crates.io, including source, headers and manifests.</p><ul>${sourceLinks}</ul><h2>Notices</h2><pre>${htmlEscape(notices)}</pre></body></html>\n`;
  const outputs = new Map([
    [generatedPaths[0], JSON.stringify(inventory, null, 2) + "\n"],
    [generatedPaths[1], notices], [generatedPaths[2], html], ...sourceArchives,
  ]);
  const manifest = {
    schemaVersion: 1, inputs,
    files: Object.fromEntries([...outputs].map(([path, data]) => [path, sha256(data)])),
  };
  outputs.set(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return outputs;
}

export function verifyManifest(base = root) {
  if (!existsSync(join(base, manifestPath))) throw new Error("Missing third-party notices; run pnpm notices:generate");
  const manifest = JSON.parse(readFileSync(join(base, manifestPath), "utf8"));
  for (const [path, expected] of Object.entries({ ...manifest.inputs, ...manifest.files })) {
    if (!existsSync(join(base, path)) || sha256(readFileSync(join(base, path))) !== expected) {
      throw new Error(`Stale or changed third-party notices: ${path}. Run pnpm notices:generate and review the diff.`);
    }
  }
  if (base === root && JSON.stringify(inputHashes()) !== JSON.stringify(manifest.inputs)) {
    throw new Error("The license input set changed. Run pnpm notices:generate and review the diff.");
  }
  if (base === root) {
    const actualSources = walkFiles(join(root, "third_party/sources"))
      .map((path) => portable(relative(root, path))).sort();
    const expectedSources = Object.keys(manifest.files)
      .filter((path) => path.startsWith("third_party/sources/")).sort();
    if (JSON.stringify(actualSources) !== JSON.stringify(expectedSources)) {
      throw new Error("The MPL source archive set changed. Run pnpm notices:generate and review the diff.");
    }
  }
}

function main() {
  const operation = process.argv[2];
  if (operation === "--verify" || operation === "--stage") {
    verifyManifest();
    if (operation === "--stage") {
      if (!existsSync(join(root, "dist/index.html"))) throw new Error("Build the frontend before staging notices");
      rmSync(join(root, "dist/licenses"), { recursive: true, force: true });
      cpSync(join(root, "third_party"), join(root, "dist/licenses"), { recursive: true });
    }
    console.log(operation === "--stage" ? "Staged offline third-party notices and MPL source archives in dist/licenses" : "Third-party notice inputs and generated files match");
    return;
  }
  if (!["--generate", "--check"].includes(operation)) throw new Error("Use --generate, --check, --verify or --stage");
  const outputs = generate();
  for (const [path, data] of outputs) {
    const destination = join(root, path);
    if (operation === "--check") {
      if (!existsSync(destination) || !readFileSync(destination).equals(Buffer.from(data))) {
        throw new Error(`Outdated generated notices: ${path}. Run pnpm notices:generate and review the diff.`);
      }
    } else {
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, data);
    }
  }
  if (operation === "--generate") {
    const wantedSources = new Set([...outputs.keys()].filter((path) => path.startsWith("third_party/sources/")));
    for (const old of walkFiles(join(root, "third_party/sources"))) {
      if (!wantedSources.has(portable(relative(root, old)))) rmSync(old);
    }
  }
  verifyManifest();
  const inventory = readJson("third_party/inventory.json");
  console.log(`${operation === "--check" ? "Verified" : "Generated"} notices for ${inventory.packages.length} packages/assets and ${inventory.targets.length} desktop targets`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { main(); } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
