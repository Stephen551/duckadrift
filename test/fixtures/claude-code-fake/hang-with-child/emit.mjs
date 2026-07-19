// Fake claude CLI (ADR-0050 deadline-tree-kill proof, POSIX). Reads a marker
// path from stdin (the test passes it as the prompt), spawns a long-lived
// GRANDCHILD that records its own pid to the marker and then sleeps forever, and
// then hangs itself. The transport's deadline must reap the whole process group:
// the grandchild must be dead after the kill, not orphaned past the deadline.
// A direct-child SIGKILL would leave the grandchild running; a process-group
// SIGKILL reaps it.
import { spawn } from "node:child_process";

let stdin = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (d) => {
  stdin += d;
});
process.stdin.on("end", () => {
  const marker = stdin.trim();
  spawn(
    process.execPath,
    ["-e", `require("fs").writeFileSync(${JSON.stringify(marker)}, String(process.pid)); setInterval(() => {}, 1000);`],
    { stdio: "ignore" }
  );
  // The parent hangs; a 60s safety self-exit for a harness that failed to kill.
  setTimeout(() => process.exit(97), 60_000);
  setInterval(() => {}, 1000);
});
