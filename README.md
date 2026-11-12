# AsePad

**Serverless launchpad + exchange on the Asentum blockchain.** AsePad is an
independent project — not affiliated with the Asentum team.

Product scope:

- **AsePad** — bonding-curve token launches (`/asepad`, `/asepad/create`, `/asepad/token/[address]`)
- **AseDex** — AMM exchange with pools, swaps, and limit orders (`/asedex`)
- **Create Token** — Standard self-custodial token or AsePad launch (`/asepad/create`)
- **Admin** — contract owner console (`/admin`)

## Architecture

Fully serverless: the Next.js frontend (`apps/web`, hosted on Netlify) talks
directly to the on-chain JavaScript contracts in
`packages/contracts/src/sources`. No API server, no database.

```
apps/
  web/        # Platform UI (Next.js 15, Tailwind, TanStack Query)
packages/
  contracts/  # Asentum JS contracts + browser-source generator + sim
  blockchain/ # SDK-facing helpers
  config/     # Env + platform + Asentum network config
  types/      # Shared TS types
  utils/      # Formatters, address helpers (Bech32 ase1… <-> hex)
tools/asentum/  # Optional local `asentum` CLI binary for deploys
scripts/        # Env sync helpers
docs/           # CONTRACTS.md, ASEPAD-V2.md, testnet-setup.md
```

## Quick start

```bash
pnpm install        # postinstall builds @asentrise/blockchain
pnpm dev            # http://localhost:3000
pnpm build:web      # production build
```

## Contracts

```bash
pnpm --filter @asentrise/contracts build   # regenerates browser sources
pnpm --filter @asentrise/contracts sim     # full-system in-memory simulation
pnpm contracts:deploy                      # deploy (asentum CLI, SDK fallback)
pnpm contracts:sync-env                    # write deployed addresses into envs
```

On-chain contracts: `arc20-factory`, `arc20-base`, `arc20-pad`, `asepad`,
`asedex`. See [docs/CONTRACTS.md](docs/CONTRACTS.md) and
[docs/ASEPAD-V2.md](docs/ASEPAD-V2.md).

## Environment

All RPC, chain ID, explorer, and contract addresses come from env (see
`.env.example`):

```env
ASENTUM_RPC_HTTP=https://explorer.asentum.com/rpc
NEXT_PUBLIC_CONTRACT_ASEPAD=
NEXT_PUBLIC_CONTRACT_ASEDEX=
NEXT_PUBLIC_CONTRACT_ARC20_FACTORY=
DEPLOYER_SECRET_KEY=
DEPLOYER_WALLET_ADDRESS=
```

Public UI shows Bech32 `ase1…` addresses; hex is used for contract calls only.

## License

Private.
