import type { Metadata } from "next";
import { LockApp } from "./lock-app";

export const metadata: Metadata = {
  title: "Token Lock",
  description:
    "Lock AseDex LP shares, ARC-20 tokens and vesting schedules on-chain. Every lock is verifiable on Asentum. Unlock, claim and transfer from the same dashboard."
};

export default function LockPage() {
  return <LockApp />;
}
