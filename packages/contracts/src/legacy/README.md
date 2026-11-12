# Legacy token templates

Retired versions of `arc20-pad.js` / `arc20-base.js` that are still deployed
on-chain. `verifyTokenSourceString` byte-matches deployed sources against every
version here, so older legitimate tokens keep the "Verified contract" badge.

- Files must stay **byte-exact** — they are regex templates, not deployable code.
- Each file must contain both markers: `// __ASEPAD_TOKEN_HEADER__` (first line)
  and `/*__ASEPAD_GENESIS__*/null`.
- Do not add comments or reformat — the verifier treats everything outside the
  two markers as a required literal.
- Rule: whenever a template in `src/sources/` changes, snapshot the OLD version
  here (`arc20-pad.vN.js` / `arc20-base.vN.js`) before shipping, then run
  `pnpm --filter @asentrise/contracts build`.
