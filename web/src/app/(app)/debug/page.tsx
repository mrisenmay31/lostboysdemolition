import { computeEstimate } from "@/lib/pricing";

// Throwaway proof page: server-renders computeEstimate() from the shared
// _shared/pricing.ts engine to prove the import path resolves and executes
// at Next.js build time, not just under vitest. Same golden-master case
// pinned in supabase/functions/_shared/pricing_test.ts ("Jorge's Interior").
//
// Moved under (app) in Task 6 so it's auth-gated like every other route —
// still reachable at /debug, just no longer anonymous.
export default function DebugPage() {
  const result = computeEstimate({
    laborMethod: "total_hours",
    totalJobHours: 34,
    dumpCount: 1,
    jobSpecificCosts: 0,
    markupPct: 25,
  });

  return (
    <main className="p-8 font-mono text-sm">
      <h1 className="mb-4 text-lg font-semibold">
        pricing.ts import proof (Jorge&apos;s Interior)
      </h1>
      <pre>{JSON.stringify(result, null, 2)}</pre>
    </main>
  );
}
