import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ExtractedContent } from "./extract.ts";
import type { SearchResult } from "./perplexity.ts";

export const CACHE_ROOT = "/tmp/pi-web-access";
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface QueryResultData {
	query: string;
	answer: string;
	results: SearchResult[];
	error: string | null;
	provider?: string;
}

export interface StoredSearchData {
	id: string;
	type: "search" | "fetch";
	timestamp: number;
	queries?: QueryResultData[];
	urls?: ExtractedContent[];
}

export interface StoredResultReference {
	id: string;
	type: "search" | "fetch";
	timestamp: number;
	cachePath: string;
}

interface CacheMetadata {
	id: string;
	type: "search" | "fetch";
	createdAt: string;
	expiresAt: string;
}

const storedResults = new Map<string, StoredSearchData>();

export function generateId(): string {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function resultCacheDir(id: string): string {
	// IDs are generated internally, but retain this guard before constructing a path.
	if (!/^[a-z0-9]+$/i.test(id)) throw new Error("Invalid cache result id");
	return join(CACHE_ROOT, id);
}

export function resultCachePath(id: string): string {
	return join(resultCacheDir(id), "content.json");
}

export function cleanupExpiredCache(now = Date.now()): void {
	if (!existsSync(CACHE_ROOT)) return;
	for (const entry of readdirSync(CACHE_ROOT, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.name === "github-repos") continue;
		const dir = join(CACHE_ROOT, entry.name);
		const metadataPath = join(dir, "metadata.json");
		try {
			const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as CacheMetadata;
			const expiresAt = Date.parse(metadata.expiresAt);
			// Bad metadata is safe to remove: dir was enumerated under our dedicated root.
			if (!metadata.id || !Number.isFinite(expiresAt) || expiresAt <= now) rmSync(dir, { recursive: true, force: true });
		} catch {
			rmSync(dir, { recursive: true, force: true });
		}
	}
}

export function storeResult(id: string, data: StoredSearchData): void {
	cleanupExpiredCache();
	const dir = resultCacheDir(id);
	const createdAt = new Date(data.timestamp).toISOString();
	const metadata: CacheMetadata = {
		id,
		type: data.type,
		createdAt,
		expiresAt: new Date(data.timestamp + CACHE_TTL_MS).toISOString(),
	};
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "content.json"), JSON.stringify(data), "utf8");
	writeFileSync(join(dir, "metadata.json"), JSON.stringify(metadata), "utf8");
	storedResults.set(id, data);
}

function loadResult(id: string): StoredSearchData | null {
	try {
		const dir = resultCacheDir(id);
		const metadata = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf8")) as CacheMetadata;
		if (metadata.id !== id || !Number.isFinite(Date.parse(metadata.expiresAt)) || Date.parse(metadata.expiresAt) <= Date.now()) return null;
		const data = JSON.parse(readFileSync(join(dir, "content.json"), "utf8"));
		return isValidStoredData(data) ? data : null;
	} catch {
		return null;
	}
}

export function getResult(id: string): StoredSearchData | null {
	return storedResults.get(id) ?? loadResult(id);
}

export function getResultReference(data: StoredSearchData): StoredResultReference {
	return { id: data.id, type: data.type, timestamp: data.timestamp, cachePath: resultCachePath(data.id) };
}

export function getAllResults(): StoredSearchData[] { return Array.from(storedResults.values()); }
export function deleteResult(id: string): boolean { return storedResults.delete(id); }
export function clearResults(): void { storedResults.clear(); }

function isValidStoredData(data: unknown): data is StoredSearchData {
	if (!data || typeof data !== "object") return false;
	const d = data as Record<string, unknown>;
	if (typeof d.id !== "string" || !d.id || (d.type !== "search" && d.type !== "fetch") || typeof d.timestamp !== "number") return false;
	return (d.type === "search" && Array.isArray(d.queries)) || (d.type === "fetch" && Array.isArray(d.urls));
}

export function restoreFromSession(ctx: ExtensionContext): void {
	storedResults.clear();
	cleanupExpiredCache();
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "custom" || entry.customType !== "web-search-results") continue;
		const data = entry.data as Partial<StoredResultReference>;
		if (typeof data?.id !== "string") continue;
		const result = loadResult(data.id);
		if (result) storedResults.set(result.id, result);
	}
}
