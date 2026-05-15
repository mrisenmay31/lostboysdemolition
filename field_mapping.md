# Lost Boys Demolition — Field Mapping Reference
Generated: 2026-05-15
Airtable Base: apptzp0IclCaAtOk2 · Jobs Table: tbl6WcLuLL0uUcpI1
GHL Location: 1ukWctiuUqC2cAs88G4Z

---

## Group 1 — Job Info

| Field Name | Airtable Field ID | GHL Field ID | Notes |
|---|---|---|---|
| Job Name | `fldbKNw609rqD97Gi` | *(native: Opportunity Name)* | |
| Job Address | `fldSmr1YCORDoagb6` | `4pjFIkOmQFpqZ5bOBI9z` | |
| Job Type | `fldc1zsXLZTY9fBQm` | `Jfb2jEzxdtHY9vhC8Zhj` | singleSelect |
| Engagement Type | ⚠️ **MISSING — not in live Jobs table** | `MPaRtiCr5OYLmTYEraVz` | Airtable field needs to be created |
| Estimator | `fldyyF2DeUFX15sXx` | `8YGC8Oy2TlRDOSZpN3Mo` | singleSelect |

---

## Group 2 — Estimate

| Field Name | Airtable Field ID | GHL Field ID | Notes |
|---|---|---|---|
| Final Estimated Price | `fldazwdB2mw4Zh0n1` | *(native: Monetary Value)* | Airtable name: "Total Bid Estimate" |
| Estimated Labor Hours | `fld6Wxf2aFXLi8FEg` | `sN6l01lwT6G8JUBPisDQ` | Airtable name: "Total Estimated Labor Hours" |
| Estimated Labor Cost | `fldduPjuhcSKbubdn` | `KVlUHcvcTtkO3IKlkaJS` | Airtable name: "Direct Labor Costs Estimate" |
| Estimated Materials | ⚠️ **MISSING — not in live Jobs table** | `XGz8SzkyU0jAx6blrT9t` | Airtable field needs to be created |
| Estimated Dump Fees | `fldkk0jYAocHCeWIX` | `VgxdlrbEYNsIYCtuuZn3` | Airtable name: "Estimated Dump Cost" |
| Estimated Overhead | `flddTODdKQqqiKpMc` | `be36GDi35Gk6Ji5hUN5Y` | Airtable name: "Estimated Overhead Allocation" |
| Estimated Profit | `fld8qD8jNqeUyA4PQ` | `zGtPySCTptCicEU51RSZ` | |
| Estimated Profit Margin | `fldZQOEFLwSyAdHrK` | `5u484IDWnOrMGkjC7eoe` | Airtable: formula field (percent) |
| Job Scope | ⚠️ **MISSING — not in live Jobs table** | `lm91PNb2dNB2g0GPoUuU` | Airtable field needs to be created (multiSelect) |
| Scope Notes | ⚠️ **MISSING — not in live Jobs table** | `PdNTCRzIpYi3IANr71eh` | Airtable field needs to be created |

---

## Group 3 — Scheduling *(omit at job creation — populated later in GHL)*

| Field Name | Airtable Field ID | GHL Field ID | Notes |
|---|---|---|---|
| Crew | `fldkP651iKPZMQ9pe` | `fZ0oA8LnX0mK1k2or4Yi` | singleSelect |
| Job Start Date | `fldOnf1hrnhJNFuRL` | `j62a5w1P2v0YvgZ3dI6z` | |
| Job End Date | `fldI6lw2qIwgbYE6G` | `5SplCgVz5cocqIX21RQs` | |
| Job Start Time | `fld5ROFJNTb36WixD` | `qJOGxmXtwExCNpoBrp1h` | |

---

## Group 4 — Integration

| Field Name | Airtable Field ID | GHL Field ID | Notes |
|---|---|---|---|
| Job ID (human-readable) | `fldNrP1Z8Ngcsyarz` | `Gtl6ADpbBGOlYYFil4n6` | Airtable: formula, e.g. JOB-1042 |
| Airtable Record ID | *(webhook `recordId`)* | `gAcQY14qFpZFPz4bDmii` | Raw record ID from webhook payload |
| GHL Opportunity ID | `fldc2Od8JX3Se1gJN` | *(native: opportunity.id)* | Written back to Airtable after create |

---

## Other Key Airtable Fields (not synced to GHL custom fields)

| Field Name | Airtable Field ID | Notes |
|---|---|---|
| Client (linked record) | `fldzu6hA8zr9Hjbfz` | Used to look up GHL Contact ID |
| GHL Contact ID (Clients table) | `fldC4zAieX10BVacc` | On `tblSJkwDdupKzsst7` |
| Ready to Schedule? | `fldG5aRScQOqUXuVE` | Used to determine initial GHL pipeline stage |
| Schedule Job Link | `fldYAfiWiqMu8SP89` | Formula field |
| Job Number (autoNumber) | `fld1ZeDoChO0h9QXO` | Raw integer; Job ID formula above = "JOB-XXXX" |

---

## ⚠️ Missing Airtable Fields — Action Required

These GHL custom fields were created in the last session but the corresponding
Airtable fields do not yet exist in the live Jobs table. The edge function will
skip these until the Airtable fields are added:

| GHL Field | GHL ID | Action Needed |
|---|---|---|
| Engagement Type | `MPaRtiCr5OYLmTYEraVz` | Add singleSelect field to Jobs table (options: Contractor Job, Homeowner Direct, Subcontract Work) |
| Estimated Materials | `XGz8SzkyU0jAx6blrT9t` | Add currency field to Jobs table |
| Job Scope | `lm91PNb2dNB2g0GPoUuU` | Add multiSelect field to Jobs table (19 scope options) |
| Scope Notes | `PdNTCRzIpYi3IANr71eh` | Add multilineText field to Jobs table |

---

## GHL Pipeline Reference

| Stage # | Stage Name | Notes |
|---|---|---|
| 3 | Estimate in Progress | Initial stage for new job creation |
| 4 | Quote Sent | |
| 5 | Quote Accepted / Pending Schedule | |
| 6 | Job Scheduled | Set by `airtable-job-scheduled` |
| 8 | Job Completed | Set by `airtable-job-completed` |
| 9 | Invoice Review | |

Pipeline ID and stage IDs are resolved at cold start by `airtable-job-created`
via `GET /opportunities/pipelines?locationId={GHL_LOCATION_ID}`.
