import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isValidJobNumber, parseCity, clientLabel, buildJobName } from "./job.ts";

Deno.test("job number validation", () => {
  assertEquals(isValidJobNumber("JOB-1100"), true);
  assertEquals(isValidJobNumber("JOB-10000"), true);   // 5 digits must pass
  assertEquals(isValidJobNumber("JOB-999"), false);
  assertEquals(isValidJobNumber("rec9AOlcpomOjzDNP"), false);
  assertEquals(isValidJobNumber("job-1100"), false);
});

Deno.test("city parsing", () => {
  assertEquals(parseCity("4285 S 300 W, Murray, UT 84107"), "Murray");
  assertEquals(parseCity("123 Main St, Salt Lake City, UT"), "Salt Lake City");
  assertEquals(parseCity("123 Main St Holladay UT 84117"), "Holladay"); // no commas: token before state
  assertEquals(parseCity("Holladay"), "Holladay");                      // bare city
  assertEquals(parseCity(""), null);
  assertEquals(parseCity(null), null);
  // Fix round 1, Finding 2: comma branch must not return the state/zip segment as the city.
  assertEquals(parseCity("Murray, UT 84107"), "Murray");
  assertEquals(parseCity("123 Main St, Murray, UT 84107, USA"), "Murray");
  assertEquals(parseCity("Murray, UT"), "Murray");
});

Deno.test("client label precedence", () => {
  assertEquals(clientLabel({companyName: "Sunline Landscape", lastName: "Smith"}), "Sunline Landscape");
  assertEquals(clientLabel({firstName: "Ann", lastName: "Morrison"}), "Morrison");
  assertEquals(clientLabel({firstName: "Ann"}), "Ann");
  assertEquals(clientLabel({}), "Client");
});

Deno.test("job name format", () => {
  assertEquals(buildJobName("JOB-1100", "Morrison", "Holladay"), "JOB-1100 – Morrison – Holladay");
  assertEquals(buildJobName("JOB-1101", "Sunline Landscape", null), "JOB-1101 – Sunline Landscape");
});
