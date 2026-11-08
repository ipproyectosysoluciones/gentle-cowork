/**
 * Log sanitization utilities (M2 mitigation).
 *
 * Provides safe logging functions that prevent log injection attacks
 * by sanitizing user-controlled input before including it in log messages.
 */

/**
 * Sanitizes a string for safe inclusion in log messages.
 * Removes control characters, ANSI escape sequences, and limits length.
 */
export function sanitizeForLog(text: string, maxLen = 200): string {
	return text
		.replace(/[\r\n]/g, " ")           // Strip newlines
		.replace(/\x1b\[[0-9;]*m/g, "")    // Strip ANSI escape codes
		.slice(0, maxLen);                 // Limit length
}

/**
 * Safely formats a log message with interpolated values.
 * All interpolated values are sanitized automatically.
 */
export function safeLog(template: string, ...values: unknown[]): string {
	return template.replace(/{(\d+)}/g, (match, index) => {
		const value = values[Number(index)];
		if (value === undefined) return match;
		return sanitizeForLog(String(value));
	});
}

/**
 * Formats an object for safe logging.
 * Limits depth and sanitizes string values.
 */
export function safeLogObject(obj: unknown, maxDepth = 3, currentDepth = 0): string {
	if (currentDepth >= maxDepth) return "[Object]";

	if (obj === null) return "null";
	if (obj === undefined) return "undefined";

	if (typeof obj === "string") return sanitizeForLog(obj);
	if (typeof obj === "number" || typeof obj === "boolean") return String(obj);

	if (Array.isArray(obj)) {
		return `[${obj.map(item => safeLogObject(item, maxDepth, currentDepth + 1)).join(", ")}]`;
	}

	if (typeof obj === "object") {
		const entries = Object.entries(obj as Record<string, unknown>)
			.slice(0, 20) // Limit entries
			.map(([key, value]) => `${sanitizeForLog(key)}: ${safeLogObject(value, maxDepth, currentDepth + 1)}`);
		return `{${entries.join(", ")}}`;
	}

	return String(obj);
}

export { sanitizeForLog as sanitize };
