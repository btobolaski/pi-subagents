import { describe, test, before, after } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { discoverAgents } from "../../src/agents/agents.ts";
import { resolveSkillPath, clearSkillCache } from "../../src/agents/skills.ts";
import { MAX_WORKFLOW_SCRIPT_BYTES, resolveWorkflowScriptInput } from "../../src/runs/foreground/subagent-executor.ts";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-path-resolution-"));
const cwdDir = path.join(tmpDir, "cwd");
const homeDir = path.join(tmpDir, "home");
const userAgentsDir = path.join(homeDir, ".agents");
const userAgentsCanary = path.join(userAgentsDir, ".data-loss-canary");
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

function restoreEnv(name: "HOME" | "USERPROFILE" | "PI_CODING_AGENT_DIR", value: string | undefined): void {
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}

before(() => {
	fs.mkdirSync(cwdDir, { recursive: true });
	fs.mkdirSync(path.join(userAgentsDir, "skills"), { recursive: true });
	fs.mkdirSync(path.join(homeDir, ".pi", "agent", "skills"), { recursive: true });
	fs.writeFileSync(userAgentsCanary, "preserve me");
	process.env.HOME = homeDir;
	process.env.USERPROFILE = homeDir;
	assert.equal(os.homedir(), homeDir);
	process.env.PI_CODING_AGENT_DIR = path.join(homeDir, ".pi", "agent");
});

after(() => {
	try {
		assert.equal(fs.readFileSync(userAgentsCanary, "utf-8"), "preserve me");
	} finally {
		restoreEnv("HOME", originalHome);
		restoreEnv("USERPROFILE", originalUserProfile);
		restoreEnv("PI_CODING_AGENT_DIR", originalAgentDir);
		clearSkillCache();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
});

describe("Path resolution for .agents and ~/.agents", () => {
	test("should resolve skills in .agents/skills", () => {
		const skillsDir = path.join(cwdDir, ".agents", "skills");
		fs.mkdirSync(skillsDir, { recursive: true });
		fs.writeFileSync(path.join(skillsDir, "test-skill-1.md"), "---\nname: test-skill-1\ndescription: test desc\n---\nSkill content");

		clearSkillCache();
		const resolved = resolveSkillPath("test-skill-1", cwdDir);
		assert.ok(resolved);
		assert.strictEqual(resolved?.path, path.join(skillsDir, "test-skill-1.md"));
	});

	test("should resolve skills in ~/.agents/skills", () => {
		const userSkillsDir = path.join(userAgentsDir, "skills");
		fs.mkdirSync(userSkillsDir, { recursive: true });
		fs.writeFileSync(path.join(userSkillsDir, "test-skill-2.md"), "---\nname: test-skill-2\ndescription: test desc\n---\nSkill content");

		clearSkillCache();
		const resolved = resolveSkillPath("test-skill-2", cwdDir);
		assert.ok(resolved);
		assert.strictEqual(resolved?.path, path.join(userSkillsDir, "test-skill-2.md"));
	});

	test("should resolve project agents from both .agents and .pi/agents", () => {
		const legacyDir = path.join(cwdDir, ".agents");
		const agentsDir = path.join(cwdDir, ".pi", "agents");
		fs.mkdirSync(path.join(cwdDir, ".agents", "skills"), { recursive: true });
		fs.mkdirSync(legacyDir, { recursive: true });
		fs.mkdirSync(agentsDir, { recursive: true });
		fs.writeFileSync(
			path.join(legacyDir, "test-agent-legacy.md"),
			"---\nname: test-agent-legacy\ndescription: Legacy agent\n---\nLegacy content"
		);
		fs.writeFileSync(
			path.join(agentsDir, "test-agent-1.md"),
			"---\nname: test-agent-1\ndescription: Test agent\n---\nAgent content"
		);

		const result = discoverAgents(cwdDir, "project");
		const legacyAgent = result.agents.find((a) => a.name === "test-agent-legacy");
		const agent = result.agents.find((a) => a.name === "test-agent-1");
		assert.ok(legacyAgent);
		assert.strictEqual(legacyAgent?.filePath, path.join(legacyDir, "test-agent-legacy.md"));
		assert.ok(agent);
		assert.strictEqual(agent?.filePath, path.join(agentsDir, "test-agent-1.md"));
	});

	test("should resolve agents in ~/.agents", () => {
		fs.writeFileSync(
			path.join(userAgentsDir, "test-agent-2.md"),
			"---\nname: test-agent-2\ndescription: Test agent\n---\nAgent content"
		);

		const result = discoverAgents(cwdDir, "user");
		const agent = result.agents.find((a) => a.name === "test-agent-2");
		assert.ok(agent);
		assert.strictEqual(agent?.filePath, path.join(userAgentsDir, "test-agent-2.md"));
	});
});

describe("workflow script path resolution", () => {
	test("loads a ~/ path from the user Pi skills directory", () => {
		const scriptPath = path.join(homeDir, ".pi", "agent", "skills", "review", "workflow.js");
		fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
		fs.writeFileSync(scriptPath, "return args.level;\n", "utf-8");

		assert.deepStrictEqual(
			resolveWorkflowScriptInput({ workflowScriptPath: "~/.pi/agent/skills/review/workflow.js", workflowArgs: { level: "high" } }, cwdDir),
			{ script: "return args.level;\n", args: { level: "high" } },
		);
	});

	test("loads project Pi scripts and rejects paths outside approved roots", () => {
		const scriptPath = path.join(cwdDir, ".pi", "workflows", "review.js");
		fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
		fs.writeFileSync(scriptPath, "return 1;\n", "utf-8");
		assert.strictEqual(resolveWorkflowScriptInput({ workflowScriptPath: scriptPath }, cwdDir).script, "return 1;\n");
		assert.throws(() => resolveWorkflowScriptInput({ workflowScriptPath: path.join(tmpDir, "outside.js") }, cwdDir), /approved Pi directory/);
		const escapedPath = `${path.join(homeDir, ".pi", "agent", "skills")}${path.sep}review${path.sep}..${path.sep}..${path.sep}outside.js`;
		assert.throws(() => resolveWorkflowScriptInput({ workflowScriptPath: escapedPath }, cwdDir), /approved Pi directory/);
		assert.throws(() => resolveWorkflowScriptInput({ workflowScriptPath: "relative.js" }, cwdDir), /must be absolute/);
	});

	test("honors configured git-root project resolution over a nested Pi directory", () => {
		const projectRoot = path.join(tmpDir, "configured-project");
		const nestedRoot = path.join(projectRoot, "packages", "nested");
		const nestedCwd = path.join(nestedRoot, "src");
		const outerScript = path.join(projectRoot, ".pi", "workflows", "outer.js");
		const nestedScript = path.join(nestedRoot, ".pi", "workflows", "nested.js");
		fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
		fs.mkdirSync(path.dirname(outerScript), { recursive: true });
		fs.mkdirSync(path.dirname(nestedScript), { recursive: true });
		fs.mkdirSync(nestedCwd, { recursive: true });
		fs.writeFileSync(path.join(projectRoot, ".pi", "settings.json"), JSON.stringify({ subagents: { projectRootResolution: "git-root" } }));
		fs.writeFileSync(outerScript, "return 'outer';\n");
		fs.writeFileSync(nestedScript, "return 'nested';\n");

		assert.strictEqual(resolveWorkflowScriptInput({ workflowScriptPath: outerScript }, nestedCwd).script, "return 'outer';\n");
		assert.throws(() => resolveWorkflowScriptInput({ workflowScriptPath: nestedScript }, nestedCwd), /approved Pi directory/);
	});

	test("sanitizes configured project-root resolution failures", { skip: process.platform === "win32" }, () => {
		const injectedUrl = "https://attacker.invalid";
		const projectRoot = path.join(tmpDir, `bad-settings-\u001b]8;;${injectedUrl}\u0007link\u001b]8;;\u0007`);
		const projectCwd = path.join(projectRoot, "src");
		const scriptPath = path.join(projectRoot, ".pi", "workflow.js");
		fs.mkdirSync(projectCwd, { recursive: true });
		fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
		fs.writeFileSync(path.join(projectRoot, ".pi", "settings.json"), "{");
		assert.throws(
			() => resolveWorkflowScriptInput({ workflowScriptPath: scriptPath }, projectCwd),
			(error: unknown) => error instanceof Error && !/[\u0000-\u001f\u007f-\u009f]/u.test(error.message) && !error.message.includes(injectedUrl),
		);
	});

	test("allows symlinked entries beneath the user skills directory", { skip: process.platform === "win32" }, () => {
		const externalScript = path.join(tmpDir, "external-workflow.js");
		const linkedScript = path.join(homeDir, ".pi", "agent", "skills", "linked-workflow.js");
		fs.writeFileSync(externalScript, "return 2;\n", "utf-8");
		fs.symlinkSync(externalScript, linkedScript);
		assert.strictEqual(resolveWorkflowScriptInput({ workflowScriptPath: linkedScript }, cwdDir).script, "return 2;\n");
	});

	test("rejects a FIFO without blocking", { skip: process.platform === "win32" }, async () => {
		const fifoPath = path.join(homeDir, ".pi", "agent", "skills", "workflow.fifo");
		const { spawnSync } = await import("node:child_process");
		const created = spawnSync("mkfifo", [fifoPath], { timeout: 1_000 });
		if (created.error && (created.error as NodeJS.ErrnoException).code === "ENOENT") return;
		assert.strictEqual(created.status, 0, created.stderr.toString());
		assert.throws(() => resolveWorkflowScriptInput({ workflowScriptPath: fifoPath }, cwdDir), /must name a file/);
	});

	test("enforces the byte limit and rejects malformed UTF-8", () => {
		const skillsDir = path.join(homeDir, ".pi", "agent", "skills");
		const exactPath = path.join(skillsDir, "exact.js");
		const invalidUtf8Path = path.join(skillsDir, "invalid-utf8.js");
		fs.writeFileSync(exactPath, Buffer.alloc(MAX_WORKFLOW_SCRIPT_BYTES, 97));
		fs.writeFileSync(invalidUtf8Path, Buffer.from([0xc3, 0x28]));

		assert.strictEqual(resolveWorkflowScriptInput({ workflowScriptPath: exactPath }, cwdDir).script.length, MAX_WORKFLOW_SCRIPT_BYTES);
		assert.throws(() => resolveWorkflowScriptInput({ workflowScriptPath: invalidUtf8Path }, cwdDir), /invalid-utf8\.js.*valid UTF-8/);
	});

	test("sanitizes workflow file read failures", { skip: process.platform === "win32" }, () => {
		const skillsDir = path.join(homeDir, ".pi", "agent", "skills");
		const injectedUrl = "https://attacker.invalid";
		const controlPath = path.join(skillsDir, `missing-\u001b]8;;${injectedUrl}\u0007link\u001b]8;;\u0007.js`);
		assert.throws(
			() => resolveWorkflowScriptInput({ workflowScriptPath: controlPath }, cwdDir),
			(error: unknown) => error instanceof Error && !/[\u0000-\u001f\u007f-\u009f]/u.test(error.message) && !error.message.includes(injectedUrl),
		);
	});

	test("rejects missing, non-file, empty, and oversized scripts", () => {
		const skillsDir = path.join(homeDir, ".pi", "agent", "skills");
		const cases: Array<{ name: string; prepare?: (filePath: string) => void; error: RegExp }> = [
			{ name: "missing.js", error: /missing\.js/ },
			{ name: "directory", prepare: (filePath) => fs.mkdirSync(filePath, { recursive: true }), error: /must name a file/ },
			{ name: "empty.js", prepare: (filePath) => fs.writeFileSync(filePath, "  \n", "utf-8"), error: /empty\.js.*empty/ },
			{ name: "oversized.js", prepare: (filePath) => fs.writeFileSync(filePath, Buffer.alloc(MAX_WORKFLOW_SCRIPT_BYTES + 1, 97)), error: /1048576-byte limit/ },
		];
		for (const testCase of cases) {
			const filePath = path.join(skillsDir, testCase.name);
			testCase.prepare?.(filePath);
			assert.throws(() => resolveWorkflowScriptInput({ workflowScriptPath: filePath }, cwdDir), testCase.error);
		}
	});
});
