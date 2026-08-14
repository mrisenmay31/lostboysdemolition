import { describe, expect, it } from "vitest";
import {
  LIFECYCLE_ACTION_STATUSES,
  isLifecycleActionStatus,
  statusLabel,
} from "@/lib/estimates/lifecycle";

describe("LIFECYCLE_ACTION_STATUSES", () => {
  it("offers exactly sent/accepted/declined — never draft/superseded/historical", () => {
    expect(LIFECYCLE_ACTION_STATUSES).toEqual(["sent", "accepted", "declined"]);
  });
});

describe("isLifecycleActionStatus", () => {
  it("accepts the 3 estimator-settable statuses", () => {
    expect(isLifecycleActionStatus("sent")).toBe(true);
    expect(isLifecycleActionStatus("accepted")).toBe(true);
    expect(isLifecycleActionStatus("declined")).toBe(true);
  });

  it("rejects the 3 system-managed statuses", () => {
    expect(isLifecycleActionStatus("draft")).toBe(false);
    expect(isLifecycleActionStatus("superseded")).toBe(false);
    expect(isLifecycleActionStatus("historical")).toBe(false);
  });

  it("rejects garbage input", () => {
    expect(isLifecycleActionStatus("")).toBe(false);
    expect(isLifecycleActionStatus("SENT")).toBe(false);
  });
});

describe("statusLabel", () => {
  it("labels all 6 DB status values, not just the 3 UI-offered ones", () => {
    expect(statusLabel("draft")).toBe("Draft");
    expect(statusLabel("sent")).toBe("Sent");
    expect(statusLabel("accepted")).toBe("Accepted");
    expect(statusLabel("declined")).toBe("Declined");
    expect(statusLabel("superseded")).toBe("Superseded");
    expect(statusLabel("historical")).toBe("Historical");
  });
});
