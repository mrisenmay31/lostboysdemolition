import { describe, expect, it } from "vitest";

// AuditTimeline.tsx has no "server-only" import and no supabase import (see
// its own module header) and this test's environment is plain "node" (see
// vitest.config.ts) — no jsdom, no @testing-library/react (neither is a
// project dependency; this repo has zero .test.tsx files anywhere, see
// __tests__ across the app). Calling the component as a plain function
// works anyway: JSX transpiles to react/jsx-runtime `jsx(...)` calls that
// just build plain element-description objects — no DOM is ever touched —
// so the empty-state and merged-list assertions below inspect
// `result.props` directly rather than rendering to anything.
import { AuditTimeline, deriveCostAuditTitle, mergeAuditRows } from "../AuditTimeline";
import type { CostAuditRow } from "@/lib/jobs/healthRepo";

interface JobEvent {
  id: number;
  stage_from: number | null;
  stage_to: number | null;
  function_name: string | null;
  action_summary: string | null;
  status: string | null;
  created_at: string;
}

function mockEvent(overrides: Partial<JobEvent> = {}): JobEvent {
  return {
    id: 1,
    stage_from: 5,
    stage_to: 6,
    function_name: "ghl-job-webhook",
    action_summary: "Job scheduled",
    status: "success",
    created_at: "2026-08-20T12:00:00Z",
    ...overrides,
  };
}

function mockAudit(overrides: Partial<CostAuditRow> = {}): CostAuditRow {
  return {
    id: "audit-1",
    category: "materials",
    reason: "TEST gate correction",
    actor_name: "Matt",
    changed_at: "2026-08-20T12:00:00Z",
    old_amount: 150,
    new_amount: 175,
    old_state: "provisional",
    new_state: "provisional",
    ...overrides,
  };
}

// ============================================================
// mergeAuditRows
// ============================================================

describe("mergeAuditRows", () => {
  it("interleaves both kinds newest-first by their own timestamp field", () => {
    const events = [
      mockEvent({ id: 1, created_at: "2026-08-20T09:00:00Z" }), // oldest
      mockEvent({ id: 2, created_at: "2026-08-20T15:00:00Z" }), // 2nd newest
    ];
    const audits = [
      mockAudit({ id: "a1", changed_at: "2026-08-20T18:00:00Z" }), // newest
      mockAudit({ id: "a2", changed_at: "2026-08-20T11:00:00Z" }), // 3rd
    ];

    const merged = mergeAuditRows(events, audits);

    expect(merged.map((row) => (row.kind === "event" ? `event-${row.event.id}` : `audit-${row.audit.id}`))).toEqual([
      "audit-a1", // 18:00
      "event-2", // 15:00
      "audit-a2", // 11:00
      "event-1", // 09:00
    ]);
  });

  it("returns an empty array when both inputs are empty", () => {
    expect(mergeAuditRows([], [])).toEqual([]);
  });

  it("returns exactly events.length + audit.length rows — the same arithmetic the page's Audit(n) badge uses", () => {
    const events = [mockEvent({ id: 1 }), mockEvent({ id: 2 }), mockEvent({ id: 3 })];
    const audits = [mockAudit({ id: "a1" }), mockAudit({ id: "a2" })];

    expect(mergeAuditRows(events, audits)).toHaveLength(events.length + audits.length);
  });

  it("handles one side empty — all-events and all-audit lists both pass through untouched", () => {
    const events = [mockEvent({ id: 1 }), mockEvent({ id: 2 })];
    expect(mergeAuditRows(events, [])).toHaveLength(2);

    const audits = [mockAudit({ id: "a1" })];
    expect(mergeAuditRows([], audits)).toHaveLength(1);
  });
});

// ============================================================
// deriveCostAuditTitle
// ============================================================

describe("deriveCostAuditTitle", () => {
  it("amount changed -> '<label> correction: $old → $new'", () => {
    const title = deriveCostAuditTitle(mockAudit({ old_amount: 150, new_amount: 175 }));
    expect(title).toBe("Materials correction: $150.00 → $175.00");
  });

  it("amount unchanged, state changed to void -> '<label> voided (<amount>)'", () => {
    const title = deriveCostAuditTitle(
      mockAudit({ old_amount: 150, new_amount: 150, old_state: "approved", new_state: "void" }),
    );
    expect(title).toBe("Materials voided ($150.00)");
  });

  it("state changed to void with only the new amount known -> shows the new amount", () => {
    const title = deriveCostAuditTitle(
      mockAudit({ old_amount: null, new_amount: 150, old_state: "approved", new_state: "void" }),
    );
    expect(title).toBe("Materials voided ($150.00)");
  });

  it("state changed to void with neither amount known -> voided with no amount suffix", () => {
    const title = deriveCostAuditTitle(
      mockAudit({ old_amount: null, new_amount: null, old_state: "approved", new_state: "void" }),
    );
    expect(title).toBe("Materials voided");
  });

  it("amount change takes priority over a simultaneous void transition", () => {
    const title = deriveCostAuditTitle(
      mockAudit({ old_amount: 150, new_amount: 175, old_state: "approved", new_state: "void" }),
    );
    expect(title).toBe("Materials correction: $150.00 → $175.00");
  });

  it("only state changed (non-void) -> '<label>: <old_state> → <new_state>'", () => {
    const title = deriveCostAuditTitle(
      mockAudit({ old_amount: 150, new_amount: 150, old_state: "provisional", new_state: "approved" }),
    );
    expect(title).toBe("Materials: provisional → approved");
  });

  it("neither amount nor state derivable -> generic '<label> correction' fallback", () => {
    const title = deriveCostAuditTitle(
      mockAudit({ old_amount: 150, new_amount: 150, old_state: "approved", new_state: "approved" }),
    );
    expect(title).toBe("Materials correction");
  });

  it("null old/new state (missing snapshot key) also falls back to the generic correction title", () => {
    const title = deriveCostAuditTitle(
      mockAudit({ old_amount: 150, new_amount: 150, old_state: null, new_state: null }),
    );
    expect(title).toBe("Materials correction");
  });

  it("unknown category falls back to the raw string", () => {
    const title = deriveCostAuditTitle(mockAudit({ category: "some_future_category" }));
    expect(title).toBe("some_future_category correction: $150.00 → $175.00");
  });

  it("empty-string category (missing embed) falls back to 'Cost entry'", () => {
    const title = deriveCostAuditTitle(mockAudit({ category: "" }));
    expect(title).toBe("Cost entry correction: $150.00 → $175.00");
  });
});

// ============================================================
// AuditTimeline — called directly as a plain function (see file header)
// ============================================================

describe("AuditTimeline", () => {
  it("renders the empty state only when BOTH jobEvents and costAudit are empty", () => {
    const result = AuditTimeline({ jobEvents: [], costAudit: [] });
    expect(result.props.children).toBe("No events recorded yet.");
  });

  it("does not render the empty state when only jobEvents is empty", () => {
    const result = AuditTimeline({ jobEvents: [], costAudit: [mockAudit()] });
    expect(result.type).toBe("ul");
  });

  it("does not render the empty state when only costAudit is empty", () => {
    const result = AuditTimeline({ jobEvents: [mockEvent()], costAudit: [] });
    expect(result.type).toBe("ul");
  });

  it("renders exactly jobEvents.length + costAudit.length list items — the combined count", () => {
    const events = [mockEvent({ id: 1 }), mockEvent({ id: 2 })];
    const audits = [mockAudit({ id: "a1" })];

    const result = AuditTimeline({ jobEvents: events, costAudit: audits });

    expect(Array.isArray(result.props.children)).toBe(true);
    expect(result.props.children).toHaveLength(events.length + audits.length);
  });
});
