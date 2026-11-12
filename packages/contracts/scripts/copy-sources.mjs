import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "src", "sources");
const to = join(root, "dist", "sources");

mkdirSync(join(root, "dist"), { recursive: true });
cpSync(from, to, { recursive: true });
console.log(`Copied contract sources → ${to}`);
