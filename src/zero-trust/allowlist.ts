/**
 * T5.7 Zero-Trust - Allowlist Store (v1)
 *
 * Simple versioned config file for worker allowlist.
 * In production, this could be replaced with a proper database.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface AllowlistEntry {
	nodeId: string;
	capabilities: string[]; // ["planner", "implementer", "verifier"]
	addedAt: string; // ISO timestamp
}

/**
 * Allowlist store - simple JSON file based implementation
 */
export class AllowlistStore {
	private readonly filePath: string;
	private allowlist: Map<string, AllowlistEntry> = new Map();
	private version: number = 1;

	constructor(filePath: string = "./allowlist.json") {
		this.filePath = filePath;
		this.load();
	}

	private load(): void {
		try {
			if (existsSync(this.filePath)) {
				const data = readFileSync(this.filePath, "utf8");
				const parsed = JSON.parse(data);
				if (parsed.version && parsed.allowlist) {
					this.version = parsed.version;
					for (const [nodeId, entry] of Object.entries(parsed.allowlist)) {
						this.allowlist.set(nodeId, entry as AllowlistEntry);
					}
				}
			}
		} catch (error) {
			console.warn(`Could not load allowlist from ${this.filePath}: ${error}`);
			// Start with empty allowlist
			this.allowlist = new Map();
			this.version = 1;
		}
	}

	private save(): void {
		const data = {
			version: this.version,
			allowlist: Object.fromEntries(this.allowlist)
		};
		writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf8");
	}

	/** Add a worker to the allowlist */
	addWorker(nodeId: string, capabilities: string[]): void {
		const entry: AllowlistEntry = {
			nodeId,
			capabilities,
			addedAt: new Date().toISOString()
		};
		this.allowlist.set(nodeId, entry);
		this.save();
	}

	/** Remove a worker from the allowlist */
	removeWorker(nodeId: string): void {
		this.allowlist.delete(nodeId);
		this.save();
	}

	/** Check if a worker is in the allowlist */
	isAllowed(nodeId: string): boolean {
		return this.allowlist.has(nodeId);
	}

	/** Get capabilities for a worker */
	getCapabilities(nodeId: string): string[] | undefined {
		const entry = this.allowlist.get(nodeId);
		return entry ? entry.capabilities : undefined;
	}

	/** Get all allowed workers */
	getAllAllowed(): AllowlistEntry[] {
		return Array.from(this.allowlist.values());
	}

	/** Increment version (for config updates) */
	incrementVersion(): void {
		this.version++;
		this.save();
	}

	/** Get current version */
	getVersion(): number {
		return this.version;
	}
}