import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PlatformContractId } from "./manifest.js";

function resolveSourcesDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "sources"), join(here, "..", "src", "sources")];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  throw new Error(
    "Contract sources not found. Run: pnpm --filter @asentrise/contracts build"
  );
}

const sourcesDir = resolveSourcesDir();

export function loadContractSource(id: PlatformContractId | string): string {
  const file = id.includes("/") ? id : `${id}.js`;
  const path = file.startsWith("modules/") ? join(sourcesDir, file) : join(sourcesDir, file);
  return readFileSync(path, "utf8");
}
