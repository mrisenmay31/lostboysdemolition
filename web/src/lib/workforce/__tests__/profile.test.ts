import { describe, expect, it, vi } from "vitest";

// Same "server-only" stub every lib test in this repo uses — see
// repo.test.ts / scheduleActions.test.ts's matching comment. profile.ts
// transitively imports "server-only" via @/lib/supabase/server even
// though the two functions under test here are pure.
vi.mock("server-only", () => ({}));

import { isActiveOwner, normalizeWorkforceProfileRow } from "../profile";

const validRow = {
  auth_user_id: "3f2a1b4c-0000-4000-8000-000000000001",
  display_name: "Matt",
  role: "owner",
  active: true,
};

describe("normalizeWorkforceProfileRow", () => {
  it("normalizes a valid row", () => {
    expect(normalizeWorkforceProfileRow(validRow)).toEqual({
      authUserId: "3f2a1b4c-0000-4000-8000-000000000001",
      displayName: "Matt",
      role: "owner",
      active: true,
    });
  });

  it.each(["pending", "owner", "foreman"])("accepts role %s", (role) => {
    expect(normalizeWorkforceProfileRow({ ...validRow, role })?.role).toBe(role);
  });

  it("returns null for an unknown role string", () => {
    expect(normalizeWorkforceProfileRow({ ...validRow, role: "admin" })).toBeNull();
  });

  it("returns null when active is not a boolean", () => {
    expect(normalizeWorkforceProfileRow({ ...validRow, active: "true" })).toBeNull();
  });

  it("returns null when display_name is blank or missing", () => {
    expect(normalizeWorkforceProfileRow({ ...validRow, display_name: "  " })).toBeNull();
    expect(normalizeWorkforceProfileRow({ ...validRow, display_name: undefined })).toBeNull();
  });

  it("returns null when auth_user_id is missing", () => {
    expect(normalizeWorkforceProfileRow({ ...validRow, auth_user_id: null })).toBeNull();
  });
});

describe("isActiveOwner", () => {
  it("is true only for active owner", () => {
    expect(isActiveOwner({ authUserId: "x", displayName: "Matt", role: "owner", active: true })).toBe(true);
  });
  it("is false for inactive owner", () => {
    expect(isActiveOwner({ authUserId: "x", displayName: "Matt", role: "owner", active: false })).toBe(false);
  });
  it("is false for active foreman and pending", () => {
    expect(isActiveOwner({ authUserId: "x", displayName: "Nick", role: "foreman", active: true })).toBe(false);
    expect(isActiveOwner({ authUserId: "x", displayName: "Matt", role: "pending", active: false })).toBe(false);
  });
  it("is false for null", () => {
    expect(isActiveOwner(null)).toBe(false);
  });
});
