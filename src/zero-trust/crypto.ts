/**
 * T5.7 Zero-Trust - Certificate generation utilities
 *
 * Real x509 certificate generation using node-forge.
 * In production, these would come from a proper CA.
 */

import forge from "node-forge";

export interface CertificatePair {
	cert: string;  // PEM-encoded certificate
	key: string;   // PEM-encoded private key
}

/**
 * Generate a self-signed certificate for testing purposes.
 * Returns PEM-encoded cert and key.
 */
export function generateCertificate(options: {
	commonName?: string;
	altNames?: string[];
	daysValid?: number;
	keySize?: number;
} = {}): CertificatePair {
	const {
		commonName = "gentle-cowork-test",
		altNames = ["localhost", "127.0.0.1"],
		daysValid = 365,
		keySize = 2048,
	} = options;

	// Generate RSA key pair
	const keys = forge.pki.rsa.generateKeyPair(keySize);

	// Create certificate
	const cert = forge.pki.createCertificate();
	cert.publicKey = keys.publicKey;
	cert.serialNumber = "01";
	cert.validity.notBefore = new Date();
	cert.validity.notAfter = new Date();
	cert.validity.notAfter.setDate(cert.validity.notBefore.getDate() + daysValid);

	// Set subject and issuer (self-signed)
	const attrs = [
		{ name: "commonName", value: commonName },
		{ name: "organizationName", value: "gentle-cowork" },
		{ name: "organizationalUnitName", value: "zero-trust" },
	];
	cert.setSubject(attrs);
	cert.setIssuer(attrs);

	// Add extensions
	cert.setExtensions([
		{
			name: "basicConstraints",
			cA: true,
		},
		{
			name: "keyUsage",
			keyCertSign: true,
			digitalSignature: true,
			keyEncipherment: true,
			dataEncipherment: true,
		},
		{
			name: "subjectAltName",
			altNames: altNames.map((name) => ({ type: 2, value: name })), // DNS type
		},
		{
			name: "subjectKeyIdentifier",
		},
	]);

	// Self-sign
	cert.sign(keys.privateKey, forge.md.sha256.create());

	// Convert to PEM
	const certPem = forge.pki.certificateToPem(cert);
	const keyPem = forge.pki.privateKeyToPem(keys.privateKey);

	return { cert: certPem, key: keyPem };
}

/**
 * Generate a CA certificate for signing other certificates.
 */
export function generateCACertificate(options: {
	commonName?: string;
	daysValid?: number;
	keySize?: number;
} = {}): CertificatePair {
	const {
		commonName = "gentle-cowork-ca",
		daysValid = 3650, // 10 years for CA
		keySize = 4096,
	} = options;

	const keys = forge.pki.rsa.generateKeyPair(keySize);

	const cert = forge.pki.createCertificate();
	cert.publicKey = keys.publicKey;
	cert.serialNumber = "01";
	cert.validity.notBefore = new Date();
	cert.validity.notAfter = new Date();
	cert.validity.notAfter.setDate(cert.validity.notBefore.getDate() + daysValid);

	const attrs = [
		{ name: "commonName", value: commonName },
		{ name: "organizationName", value: "gentle-cowork" },
		{ name: "organizationalUnitName", value: "zero-trust-ca" },
	];
	cert.setSubject(attrs);
	cert.setIssuer(attrs);

	cert.setExtensions([
		{
			name: "basicConstraints",
			cA: true,
			pathLenConstraint: 0,
		},
		{
			name: "keyUsage",
			keyCertSign: true,
			cRLSign: true,
		},
		{
			name: "subjectKeyIdentifier",
		},
	]);

	cert.sign(keys.privateKey, forge.md.sha256.create());

	const certPem = forge.pki.certificateToPem(cert);
	const keyPem = forge.pki.privateKeyToPem(keys.privateKey);

	return { cert: certPem, key: keyPem };
}

/**
 * Sign a certificate request with a CA.
 */
export function signCertificate(csrPem: string, caCertPem: string, caKeyPem: string, daysValid = 365): string {
	const csr = forge.pki.certificationRequestFromPem(csrPem);
	if (!csr.publicKey) {
		throw new Error("CSR has no public key");
	}
	const caCert = forge.pki.certificateFromPem(caCertPem);
	const caKey = forge.pki.privateKeyFromPem(caKeyPem);

	// Verify CSR signature
	if (!csr.verify()) {
		throw new Error("Invalid CSR signature");
	}

	const cert = forge.pki.createCertificate();
	cert.publicKey = csr.publicKey;
	cert.serialNumber = forge.util.bytesToHex(forge.random.getBytesSync(16));
	cert.validity.notBefore = new Date();
	cert.validity.notAfter = new Date();
	cert.validity.notAfter.setDate(cert.validity.notBefore.getDate() + daysValid);

	cert.setSubject(csr.subject.attributes);
	cert.setIssuer(caCert.subject.attributes);

	cert.setExtensions([
		{
			name: "basicConstraints",
			cA: false,
		},
		{
			name: "keyUsage",
			digitalSignature: true,
			keyEncipherment: true,
		},
		{
			name: "extendedKeyUsage",
			clientAuth: true,
			serverAuth: true,
		},
		{
			name: "subjectKeyIdentifier",
		},
		{
			name: "authorityKeyIdentifier",
			keyIdentifier: caCert.generateSubjectKeyIdentifier().toHex(),
		},
	]);

	cert.sign(caKey, forge.md.sha256.create());

	return forge.pki.certificateToPem(cert);
}

/**
 * Verify a certificate against a CA.
 */
export function verifyCertificate(certPem: string, caCertPem: string): boolean {
	try {
		const cert = forge.pki.certificateFromPem(certPem);
		const caCert = forge.pki.certificateFromPem(caCertPem);
		return caCert.verify(cert);
	} catch {
		return false;
	}
}

/**
 * Parse PEM certificate and return metadata.
 */
export function parseCertificate(certPem: string): {
	subject: Record<string, string>;
	issuer: Record<string, string>;
	validFrom: Date;
	validTo: Date;
	serialNumber: string;
	fingerprintSha256: string;
} | null {
	try {
		const cert = forge.pki.certificateFromPem(certPem);
		const subject: Record<string, string> = {};
		const issuer: Record<string, string> = {};

		for (const attr of cert.subject.attributes) {
			if (attr.name && attr.value !== undefined) {
				const val = attr.value;
				subject[attr.name] = Array.isArray(val) ? JSON.stringify(val) : String(val);
			}
		}
		for (const attr of cert.issuer.attributes) {
			if (attr.name && attr.value !== undefined) {
				const val = attr.value;
				issuer[attr.name] = Array.isArray(val) ? JSON.stringify(val) : String(val);
			}
		}

		const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
		const fingerprint = forge.md.sha256.create();
		fingerprint.update(der);

		return {
			subject,
			issuer,
			validFrom: cert.validity.notBefore,
			validTo: cert.validity.notAfter,
			serialNumber: cert.serialNumber,
			fingerprintSha256: fingerprint.digest().toHex(),
		};
	} catch {
		return null;
	}
}

/**
 * Check if certificate is expired or expiring soon.
 */
export function isCertificateExpiring(certPem: string, daysThreshold = 30): boolean {
	const parsed = parseCertificate(certPem);
	if (!parsed) return true;
	const now = new Date();
	const threshold = new Date(now.getTime() + daysThreshold * 24 * 60 * 60 * 1000);
	return parsed.validTo <= threshold;
}
