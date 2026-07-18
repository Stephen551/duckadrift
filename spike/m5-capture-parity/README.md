# M5.3 PR E parity capture: run chronology (evidence index)

Three orchestrator invocations produced the corpus. What each event is
recorded IN matters; this index says exactly where, so no artifact is cited
for an event it does not contain.

**Invocation 1** (journal run 1, 2 units, outcome `errored`): duckadrift/S1
captured live (114.7s). duckadrift/S4 killed by the owned 120s deadline; the
terminal transport error is journaled verbatim in that run's second unit.
Nothing partial was written for S4.

**Invocation 2** (journal run 2, 6 units): duckadrift/S1 skipped cached at
$0 (4ms). duckadrift/S4 re-captured FRESH at full token cost (209.6s) under
the 900s corpus ceiling; the deadline recovery is a paid re-send by design
(ADR-0045: an exhausted or killed unit lands incomplete and re-runs).
duckadrift/S5 and fonthead S1/S4/S5 captured live. The invocation then DIED
at cosmos-sdk's context load (its ADRs live at `docs/architecture`, outside
the default candidates): an uncaught SetupError, BEFORE the orchestrator
carried journaled load-refusal handling. That crash is therefore NOT in the
journal, and run 2's recorded outcome reads `completed` because the process
died after its last per-unit save. The evidence for the crash is the
invocation's stderr (the SetupError naming the repo and the candidates), the
roster's per-repo adrDir additions taken verbatim from the api harvest
manifests, and the orchestrator commit that added the load-refusal
journaling for every later run.

**Invocation 3** (journal run 3, 27 units, outcome `completed`): the six
completed units skipped cached at $0 (3 to 5ms each), backstage produced its
three honest no-input skips, and the remaining fifteen units captured live
through second-internal-log/S5.

Zero-cost applies ONLY to the nine cached skips across invocations 2 and 3.
Every capture, including the S4 deadline recovery, was a full-cost live
send. No quota pause occurred in any invocation; the 429 class stays
documented-not-observed.
