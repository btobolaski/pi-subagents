import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizePublicSubagentExecution } from "../../src/extension/public-execution.ts";

describe("public subagent execution normalization", () => {
	it("accepts workflow execution, management, and workflowScript schedules", () => {
		assert.deepEqual(normalizePublicSubagentExecution({ workflowScript: "return 1" }), { ok: true, params: { workflowScript: "return 1" } });
		assert.deepEqual(
			normalizePublicSubagentExecution({ workflowScriptPath: "~/.pi/agent/skills/review/workflow.js", workflowArgs: { level: "high" } }),
			{ ok: true, params: { workflowScriptPath: "~/.pi/agent/skills/review/workflow.js", workflowArgs: { level: "high" } } },
		);
		assert.deepEqual(normalizePublicSubagentExecution({ action: " list " }), { ok: true, params: { action: "list" } });
		assert.deepEqual(
			normalizePublicSubagentExecution({ action: " schedule.create ", every: "1h", workflowScript: "return 1" }),
			{ ok: true, params: { action: "schedule.create", every: "1h", workflowScript: "return 1" } },
		);
	});

	it("rejects removed public execution shapes", () => {
		for (const params of [
			{ action: " " },
			{ action: "single" },
			{ action: "parallel" },
			{ action: "chain" },
			{ agent: "worker", task: "work" },
			{ tasks: [{ agent: "worker" }] },
			{ chain: [{ agent: "worker" }] },
			{ parallel: [{ agent: "worker" }] },
			{ concurrency: 2 },
			{ clarify: true, workflowScript: "return 1" },
			{ resume: "retained-run", workflowScript: "return 1" },
			{},
			{ workflowScript: " " },
			{ workflowScriptPath: " " },
			{ workflowScript: "return 1", workflowScriptPath: "/tmp/workflow.js" },
			{ workflowArgs: { level: "high" } },
			{ workflowScript: "return 1", workflowArgs: { level: 2 } },
			{ workflowScript: "return 1", workflowArgs: ["high"] },
			{ action: "status", workflowScript: "return 1" },
			{ action: "status", workflowScriptPath: "/tmp/workflow.js" },
			{ action: "schedule.create", every: "1h", workflowScriptPath: "/tmp/workflow.js" },
			{ action: "schedule.create", every: "1h", workflowScript: "return 1", workflowArgs: {} },
			{ action: "schedule.create", every: "1h", agent: "worker", workflowScript: "return 1" },
		] as const) {
			assert.equal(normalizePublicSubagentExecution(params).ok, false, JSON.stringify(params));
		}
	});
});
