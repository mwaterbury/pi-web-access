import assert from "node:assert/strict";
import { test } from "node:test";

const storageUrl = new URL("../storage.ts", import.meta.url).href;

function run(script) {
	return import("node:child_process").then(({ spawnSync }) => spawnSync(process.execPath, ["--input-type=module"], { input: script, encoding: "utf8" }));
}

test("result cache writes content and 24-hour metadata, then cleans expired entries", async () => {
	const child = await run(`
		const s = await import(${JSON.stringify(storageUrl)});
		s.cleanupExpiredCache();
		const id = 'cachetest' + Date.now().toString(36);
		const data = { id, type: 'fetch', timestamp: Date.now(), urls: [] };
		s.storeResult(id, data);
		console.log(JSON.stringify({ path: s.resultCachePath(id), metadata: JSON.parse(await (await import('node:fs/promises')).readFile(s.resultCacheDir(id) + '/metadata.json', 'utf8')) }));
		await (await import('node:fs/promises')).writeFile(s.resultCacheDir(id) + '/metadata.json', JSON.stringify({ id, type: 'fetch', expiresAt: new Date(0).toISOString() }));
		s.cleanupExpiredCache();
		console.log((await import('node:fs')).existsSync(s.resultCacheDir(id)));
	`);
	assert.equal(child.status, 0, child.stderr);
	const [written, removed] = child.stdout.trim().split("\n");
	const value = JSON.parse(written);
	assert.match(value.path, /^\/tmp\/pi-web-access\/cachetest/);
	assert.equal(value.metadata.type, "fetch");
	assert.equal(Date.parse(value.metadata.expiresAt) - Date.parse(value.metadata.createdAt), 24 * 60 * 60 * 1000);
	assert.equal(removed, "false");
});

test("session reference excludes result bodies and cache miss returns null", async () => {
	const child = await run(`
		const s = await import(${JSON.stringify(storageUrl)});
		const id = 'ref' + Date.now().toString(36);
		const data = { id, type: 'fetch', timestamp: Date.now(), urls: [{ url: 'x', title: 't', content: 'full body', error: null }] };
		s.storeResult(id, data);
		console.log(JSON.stringify(s.getResultReference(data)));
		await (await import('node:fs/promises')).rm(s.resultCacheDir(id), { recursive: true, force: true });
		s.clearResults(); console.log(s.getResult(id));
	`);
	assert.equal(child.status, 0, child.stderr);
	const [reference, missed] = child.stdout.trim().split("\n");
	assert.deepEqual(Object.keys(JSON.parse(reference)).sort(), ["cachePath", "id", "timestamp", "type"]);
	assert.equal(missed, "null");
});
