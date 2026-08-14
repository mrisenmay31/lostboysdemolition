import { describe, expect, it, vi } from "vitest";

// vitest runs in a plain Node environment (no "react-server" export
// condition), so the real server-only package throws on import outside a
// Server Component. Stub it so log.ts's `import "server-only"` is inert
// under test — same pattern used by rates.test.ts.
vi.mock("server-only", () => ({}));

import { writeJobEvent, writeSyncLog } from "@/lib/log";

function makeSupabase(insertResult: { error: unknown } | null) {
  const insert = vi.fn().mockResolvedValue(insertResult ?? { error: null });
  const from = vi.fn().mockReturnValue({ insert });
  return { supabase: { from }, insert, from };
}

describe("writeSyncLog", () => {
  it("inserts into sync_log with the given entry verbatim", async () => {
    const { supabase, insert, from } = makeSupabase({ error: null });
    const entry = {
      direction: "app_to_ghl",
      trigger_event: "estimate_push_fields",
      action_taken: "created" as const,
      status: "success" as const,
      payload_in: { estimateId: "abc" },
    };

    await writeSyncLog(supabase, entry);

    expect(from).toHaveBeenCalledWith("sync_log");
    expect(insert).toHaveBeenCalledWith(entry);
  });

  it("swallows a Postgres error returned by insert() — logs, does not throw", async () => {
    const { supabase } = makeSupabase({ error: { message: "constraint violation" } });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      writeSyncLog(supabase, {
        direction: "app_to_ghl",
        trigger_event: "estimate_push_fields",
        action_taken: "error",
        status: "error",
        error_message: "boom",
      }),
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("swallows a thrown exception from the client itself — logs, does not throw", async () => {
    const supabase = { from: vi.fn().mockImplementation(() => { throw new Error("network down"); }) };
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      writeSyncLog(supabase, {
        direction: "app_to_ghl",
        trigger_event: "estimate_push_fields",
        action_taken: "error",
        status: "error",
      }),
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe("writeJobEvent", () => {
  it("inserts into job_events with the given event verbatim", async () => {
    const { supabase, insert, from } = makeSupabase({ error: null });
    const event = {
      job_number: null,
      stage_from: null,
      stage_to: 3,
      function_name: "web-estimate-push",
      trigger_source: "app",
      ghl_opportunity_id: "opp-1",
      action_summary: "Created GHL opportunity for estimate #1416 v1",
      status: "success" as const,
    };

    await writeJobEvent(supabase, event);

    expect(from).toHaveBeenCalledWith("job_events");
    expect(insert).toHaveBeenCalledWith(event);
  });

  it("swallows a Postgres error returned by insert() — logs, does not throw", async () => {
    const { supabase } = makeSupabase({ error: { message: "not null violation" } });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      writeJobEvent(supabase, {
        job_number: null,
        stage_from: null,
        stage_to: 3,
        function_name: "web-estimate-push",
        trigger_source: "app",
        action_summary: "x",
        status: "error",
      }),
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("swallows a thrown exception from the client itself — logs, does not throw", async () => {
    const supabase = { from: vi.fn().mockImplementation(() => { throw new Error("network down"); }) };
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      writeJobEvent(supabase, {
        job_number: null,
        stage_from: null,
        stage_to: 3,
        function_name: "web-estimate-push",
        trigger_source: "app",
        action_summary: "x",
        status: "error",
      }),
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
