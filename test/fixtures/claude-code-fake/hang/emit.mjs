// Fake claude CLI (test harness, ADR-0044 deadline proof): emits nothing and
// never exits on its own, the measured total-denial shape (PR B: the real CLI
// retried for the full 120s window and had to be killed by the caller). A 60s
// self-exit is a safety net for a harness that failed to kill it; the
// transport's deadline must fire long before.
setTimeout(() => process.exit(97), 60_000);
setInterval(() => {}, 1_000);
