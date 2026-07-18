import { fileURLToPath } from "node:url";
import { delimiter, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { Tier1TransportError, claudeCodeTransport } from "../src/tier1/transport.js";

// The live claude-code transport, proven deterministically (ADR-0044): a fake
// claude CLI per scenario replays PR B's committed captures verbatim against
// the REAL spawn path. Zero credentials, zero network, zero live calls; the
// token below is a syntactically-shaped test constant the fake never reads.

const __dirname = dirname(fileURLToPath(import.meta.url));
const FAKE_ROOT = join(__dirname, "fixtures", "claude-code-fake");

/** An env whose PATH resolves `claude` to the named scenario's fake, with the real PATH behind it so node itself resolves. */
function scenarioEnv(scenario: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ANTHROPIC_API_KEY: undefined,
    PATH: `${join(FAKE_ROOT, scenario)}${delimiter}${process.env.PATH ?? ""}`,
    CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-test-harness-token-never-real",
  };
}

function request(model = "claude-sonnet-5"): object {
  // The realized surface (PR D): system blocks ride --system-prompt-file,
  // the forced tool's schema rides --json-schema, the user message rides
  // stdin. The fakes ignore argv; the REQUEST must still carry all three or
  // the transport refuses to realize it.
  return {
    model,
    max_tokens: 1024,
    output_config: { effort: "high" },
    system: [{ type: "text", text: "You are the harness probe." }],
    tools: [{ name: "report_findings", input_schema: { type: "object", properties: { findings: { type: "array" } }, required: ["findings"] } }],
    messages: [{ role: "user", content: "Reply with exactly: pong" }],
  };
}

const DEADLINE = { deadlineSeconds: 60 };

async function errorFrom(promise: Promise<unknown>): Promise<Tier1TransportError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(Tier1TransportError);
    return err as Tier1TransportError;
  }
  throw new Error("expected the transport to throw, and it returned");
}

describe("claude-code transport: the taxonomy against the real spawn path (ADR-0044)", () => {
  it("canonical envelope: extraction maps structured_output into the api-canonical tool call, usage intact", async () => {
    const transport = claudeCodeTransport({ ...DEADLINE, env: scenarioEnv("canonical") });
    const result = await transport.send(request());
    const response = result.response as { content: Array<Record<string, unknown>>; usage: Record<string, unknown> };
    expect(response.content).toHaveLength(1);
    expect(response.content[0]!.type).toBe("tool_use");
    expect(response.content[0]!.name).toBe("report_findings");
    expect(response.content[0]!.input).toEqual({ findings: [] });
    const usage = result.usage as Record<string, unknown>;
    expect(usage.input_tokens).toBe(2);
    expect(usage.output_tokens).toBe(65);
    // Raw modelUsage bytes ride the mapped response (the verified echo the
    // recording's model key rests on).
    const modelUsage = (result.response as Record<string, unknown>).modelUsage as Record<string, unknown>;
    expect(Object.keys(modelUsage)).toEqual(["claude-sonnet-5"]);
  });

  it("auth: the measured 401 envelope surfaces as a distinct auth-class error", async () => {
    const transport = claudeCodeTransport({ ...DEADLINE, env: scenarioEnv("auth-401") });
    const err = await errorFrom(transport.send(request()));
    expect(err.kind).toBe("auth");
    expect(err.message).toContain("401");
  });

  it("quota: the documented 429 family surfaces as a distinct quota-class error (documented-not-observed)", async () => {
    const transport = claudeCodeTransport({ ...DEADLINE, env: scenarioEnv("quota-429") });
    const err = await errorFrom(transport.send(request()));
    expect(err.kind).toBe("quota");
    expect(err.message).toContain("429");
  });

  it("malformed envelope: non-JSON stdout surfaces as a transport-class error", async () => {
    const transport = claudeCodeTransport({ ...DEADLINE, env: scenarioEnv("malformed") });
    const err = await errorFrom(transport.send(request()));
    expect(err.kind).toBe("transport");
    expect(err.message).toContain("malformed envelope");
  });

  it("spawn failure: no claude on PATH surfaces as a transport-class error", async () => {
    const env = scenarioEnv("canonical");
    env.PATH = dirname(process.execPath); // node resolves; claude does not
    const transport = claudeCodeTransport({ ...DEADLINE, env });
    const err = await errorFrom(transport.send(request()));
    expect(err.kind).toBe("transport");
  });

  it("credential absence inside send is a loud auth-class error, never a silent skip", async () => {
    const env = scenarioEnv("canonical");
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
    const transport = claudeCodeTransport({ ...DEADLINE, env });
    const err = await errorFrom(transport.send(request()));
    expect(err.kind).toBe("auth");
    expect(err.message).toContain("CLAUDE_CODE_OAUTH_TOKEN");
  });

  it("a config value outside the command-line-safe charset is refused, never quoted into a shell", async () => {
    const transport = claudeCodeTransport({ ...DEADLINE, env: scenarioEnv("canonical") });
    const err = await errorFrom(transport.send(request('claude-sonnet-5"; rm -rf .')));
    expect(err.kind).toBe("transport");
    expect(err.message).toContain("charset");
  });

  it("model verification: an envelope whose modelUsage names a different model is refused (ADR-0044 decision 4)", async () => {
    const transport = claudeCodeTransport({ ...DEADLINE, env: scenarioEnv("wrong-model") });
    const err = await errorFrom(transport.send(request()));
    expect(err.kind).toBe("transport");
    expect(err.message).toContain("model");
  });

  it(
    "the owned deadline: a CLI that never terminates is killed and surfaces a terminal transport error naming the deadline (ADR-0044 decision 2)",
    { timeout: 20_000 },
    async () => {
      const transport = claudeCodeTransport({ deadlineSeconds: 2, env: scenarioEnv("hang") });
      const started = Date.now();
      const err = await errorFrom(transport.send(request()));
      expect(err.kind).toBe("transport");
      expect(err.message).toContain("deadline");
      // Killed by the deadline, not by the fake's 60s safety self-exit.
      expect(Date.now() - started).toBeLessThan(15_000);
    }
  );
});
