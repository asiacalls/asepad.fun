import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col items-center justify-center px-4 py-24 text-center">
      <div className="text-5xl font-semibold tracking-tight">404</div>
      <div className="mt-3 text-sm text-white/60">This page does not exist.</div>
      <div className="mt-6">
        <Button asChild>
          <Link href="/">Return home</Link>
        </Button>
      </div>
    </div>
  );
}

