import { execSync } from "node:child_process";
process.env.STATIC_EXPORT = "1";
process.env.NODE_OPTIONS = "--max-old-space-size=8192";
execSync("next build", { stdio: "inherit", env: process.env });
