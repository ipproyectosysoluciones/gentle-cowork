/**
 * T5.7 Zero-Trust - mTLS Handshake Implementation
 *
 * Real mTLS implementation using node:https and node-forge for certificate validation.
 */

import { createServer, type ServerOptions } from "node:https";
import { readFileSync } from "node:fs";
import forge from "node-forge";

export interface MTLSConfig {
	cert: string;              // Server certificate (PEM)
	key: string;               // Server private key (PEM)
	ca: string;                // Certificate Authority (PEM) for verifying client certificates
	requestCert: boolean;      // Whether to request client certificate
	rejectUnauthorized: boolean; // Whether to reject unauthorized clients
}

/**
 * Create an HTTPS server with mTLS configuration.
 * Validates client certificates against the provided CA.
 */
export function createMTLSServer(options: {
	cert: string;
	key: string;
	ca: string;
	port: number;
}): ReturnType<typeof createServer> {
	const serverOptions: ServerOptions = {
		cert: options.cert,
		key: options.key,
		ca: options.ca,
		requestCert: true,        // Request client certificate
		rejectUnauthorized: true, // Reject unauthorized clients
	};

	const server = createServer(serverOptions);

	// Log certificate verification results
	server.on("tlsClientError", (err, socket) => {
		const remoteAddr = socket.remoteAddress ?? "unknown";
		console.error(`[mTLS] Client error from ${remoteAddr}: ${err.message}`);
		socket.destroy();
	});

	return server;
}

/**
 * Create an HTTPS server that uses a callback for custom certificate verification.
 * Allows implementing custom verification logic (e.g., allowlist by fingerprint).
 */
export function createMTLSServerWithCallback(options: {
	cert: string;
	key: string;
	ca: string;
	port: number;
	verifyCallback?: (cert: forge.pki.Certificate, host: string) => boolean;
}): ReturnType<typeof createServer> {
	const serverOptions: ServerOptions = {
		cert: options.cert,
		key: options.key,
		ca: options.ca,
		requestCert: true,
		rejectUnauthorized: true,
	};

	const server = createServer(serverOptions);

	server.on("secureConnection", (tlsSocket) => {
		const clientCert = tlsSocket.getPeerCertificate(true);
		if (!clientCert || !clientCert.raw) {
			console.error("[mTLS] No client certificate provided");
			tlsSocket.destroy();
			return;
		}

		// Convert to forge certificate for custom verification
			const der = clientCert.raw;
			const b64 = Buffer.from(der).toString("base64");
			const chunks = b64.match(/.{1,64}/g) ?? [];
			const pem = "-----BEGIN CERTIFICATE-----\n" + chunks.join("\n") + "\n-----END CERTIFICATE-----";

		try {
			const forgeCert = forge.pki.certificateFromPem(pem);

			// Run custom verification if provided
			if (options.verifyCallback) {
				const authorized = options.verifyCallback(forgeCert, tlsSocket.remoteAddress ?? "unknown");
				if (!authorized) {
					console.error("[mTLS] Certificate rejected by custom verifier");
					tlsSocket.destroy();
					return;
				}
			}

			// Also verify against CA
			const caCert = forge.pki.certificateFromPem(options.ca);
			if (!caCert.verify(forgeCert)) {
				console.error("[mTLS] Certificate chain verification failed");
				tlsSocket.destroy();
				return;
			}

			// Check expiration
			const now = new Date();
			if (now > forgeCert.validity.notAfter || now < forgeCert.validity.notBefore) {
				console.error("[mTLS] Certificate expired or not yet valid");
				tlsSocket.destroy();
				return;
			}

			// Certificate is valid - attach to socket for downstream use
			(tlsSocket as any).verifiedCert = forgeCert;
		} catch (err) {
			console.error(`[mTLS] Certificate parsing error: ${err instanceof Error ? err.message : String(err)}`);
			tlsSocket.destroy();
		}
	});

	return server;
}

/**
 * Generate a self-signed certificate for testing purposes.
 */
export function generateCertificate(): { cert: string; key: string } {
	const { crypto } = require("webcrypto");
	const { forge } = require("node-forge");

	const keys = forge.pki.rsa.generateKeyPair(2048);
	const cert = forge.pki.createCertificate();
	cert.publicKey = keys.publicKey;
	cert.serialNumber = "01";
	cert.validity.notBefore = new Date();
	cert.validity.notAfter = new Date();
	cert.validity.notAfter.setDate(cert.validity.notBefore.getDate() + 365);

	const attrs = [
		{ name: "commonName", value: "gentle-cowork-test" },
		{ name: "organizationName", value: "gentle-cowork" },
		{ name: "organizationalUnitName", value: "zero-trust" },
	];
	cert.setSubject(attrs);
	cert.setIssuer(attrs);
	cert.setExtensions([
		{ name: "basicConstraints", cA: true },
		{ name: "keyUsage", keyCertSign: true, digitalSignature: true, keyEncipherment: true, dataEncipherment: true },
		{ name: "subjectAltName", altNames: [{ type: 2, value: "localhost" }, { type: 2, value: "127.0.0.1" }] },
		{ name: "subjectKeyIdentifier" },
	]);
	cert.sign(keys.privateKey, forge.md.sha256.create());

	return {
		cert: forge.pki.certificateToPem(cert),
		key: forge.pki.privateKeyToPem(keys.privateKey),
	};
}

/**
 * Generate a CA certificate for testing purposes.
 */
export function generateCACertificate(): { cert: string; key: string } {
	const keys = forge.pki.rsa.generateKeyPair(4096);
	const cert = forge.pki.createCertificate();
	cert.publicKey = keys.publicKey;
	cert.serialNumber = "01";
	cert.validity.notBefore = new Date();
	cert.validity.notAfter = new Date();
	cert.validity.notAfter.setDate(cert.validity.notBefore.getDate() + 3650);

	const attrs = [
		{ name: "commonName", value: "gentle-cowork-ca" },
		{ name: "organizationName", value: "gentle-cowork" },
		{ name: "organizationalUnitName", value: "zero-trust-ca" },
	];
	cert.setSubject(attrs);
	cert.setIssuer(attrs);
	cert.setExtensions([
		{ name: "basicConstraints", cA: true, pathLenConstraint: 0 },
		{ name: "keyUsage", keyCertSign: true, cRLSign: true },
		{ name: "subjectKeyIdentifier" },
	]);
	cert.sign(keys.privateKey, forge.md.sha256.create());

	return {
		cert: forge.pki.certificateToPem(cert),
		key: forge.pki.privateKeyToPem(keys.privateKey),
	};
}

/**
 * Load certificate and key from files.
 */
export function loadCertAndKey(certPath: string, keyPath: string): { cert: string; key: string } {
	return {
		cert: readFileSync(certPath, "utf8"),
		key: readFileSync(keyPath, "utf8"),
	};
}

/**
 * Load CA certificate from file.
 */
export function loadCA(caPath: string): string {
	return readFileSync(caPath, "utf8");
}
