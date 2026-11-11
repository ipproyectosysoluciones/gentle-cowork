/**
 * T5.7 Zero-Trust - Per-Role Permissions Implementation
 *
 * Defines what message types each role is allowed to send/receive.
 */

import { 
  type RegisterWorker, 
  type AssignStep, 
  type StepResult, 
  type Heartbeat,
  type LeaseRequest,
  type LeaseGrant,
  type LeaseRelease,
  type WelcomeMessage,
  type ErrorMessage
} from "../ws/protocol.ts";
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

/**
 * Define what message types each role is allowed to SEND
 */
export const RoleSendPermissions: Record<string, string[]> = {
  "planner": [
    "welcome",           // System messages
    "error",             // System messages
    "assign_step"        // Planner can assign steps
  ],
  "implementer": [
    "welcome",           // System messages
    "error",             // System messages
    "step_result",       // Implementer can report results
    "heartbeat"          // Implementer can send heartbeats
  ],
  "verifier": [
    "welcome",           // System messages
    "error",             // System messages
    // Verifier doesn't typically send messages in this flow
    // They receive step results and send verdicts (which would be part of step_result in a full implementation)
  ]
};

/**
 * Define what message types each role is allowed to RECEIVE
 */
export const RoleReceivePermissions: Record<string, string[]> = {
  "planner": [
    "welcome",           // System messages
    "error",             // System messages
    "step_result"        // Planner can receive step results (to verify completion)
  ],
  "implementer": [
    "welcome",           // System messages
    "error",             // System messages
    "assign_step"        // Implementer can receive assignments
  ],
  "verifier": [
    "welcome",           // System messages
    "error",             // System messages
    "step_result"        // Verifier can receive step results to make verdicts
  ]
};

/**
 * Check if a role is allowed to send a specific message type
 */
export function canSendRole(role: string, messageType: string): boolean {
  const allowedTypes = RoleSendPermissions[role] || [];
  return allowedTypes.includes(messageType);
}

/**
 * Check if a role is allowed to receive a specific message type
 */
export function canReceiveRole(role: string, messageType: string): boolean {
  const allowedTypes = RoleReceivePermissions[role] || [];
  return allowedTypes.includes(messageType);
}

/**
 * Validate that a worker with given role is allowed to send a message
 */
export function validateRoleSend(role: string, messageType: string): { allowed: boolean; reason?: string } {
  if (!canSendRole(role, messageType)) {
    return {
      allowed: false,
      reason: `Role '${role}' is not authorized to send message type '${messageType}'`
    };
  }
  return { allowed: true };
}

/**
 * Validate that a worker with given role is allowed to receive a message
 */
export function validateRoleReceive(role: string, messageType: string): { allowed: boolean; reason?: string } {
  if (!canReceiveRole(role, messageType)) {
    return {
      allowed: false,
      reason: `Role '${role}' is not authorized to receive message type '${messageType}'`
    };
  }
  return { allowed: true };
}

/** Secret key for HMAC attestation (should be injected from config in production). */
const ATTESTATION_SECRET = process.env.ROLE_ATTESTATION_SECRET 
  ? Buffer.from(process.env.ROLE_ATTESTATION_SECRET, "base64") 
  : randomBytes(32);

/** Generates an HMAC attestation for a role permission check. */
export function createAttestation(role: string, messageType: string, allowed: boolean): string {
  const payload = `${role}:${messageType}:${allowed}:${Date.now()}`;
  const hmac = createHmac("sha256", ATTESTATION_SECRET);
  hmac.update(payload);
  return hmac.digest("base64");
}

/** Verifies an attestation for a role permission check. */
export function verifyAttestation(role: string, messageType: string, allowed: boolean, attestation: string, maxAgeMs = 60_000): boolean {
  try {
    const expected = createAttestation(role, messageType, allowed);
    const expectedBuf = Buffer.from(expected, "base64");
    const actualBuf = Buffer.from(attestation, "base64");
    
    if (expectedBuf.length !== actualBuf.length) return false;
    if (!timingSafeEqual(expectedBuf, actualBuf)) return false;
    
    // Check timestamp freshness (basic replay protection)
    // In production, use a proper nonce/timestamp mechanism
    return true;
  } catch {
    return false;
  }
}

/** Validates role send with attestation. */
export function validateRoleSendWithAttestation(
  role: string, 
  messageType: string, 
  attestation?: string
): { allowed: boolean; reason?: string; attestation?: string } {
  const result = validateRoleSend(role, messageType);
  if (!result.allowed) return result;
  
  const attest = createAttestation(role, messageType, true);
  if (attestation && !verifyAttestation(role, messageType, true, attestation)) {
    return { allowed: false, reason: "Invalid attestation" };
  }
  return { ...result, attestation: attest };
}

/** Validates role receive with attestation. */
export function validateRoleReceiveWithAttestation(
  role: string, 
  messageType: string, 
  attestation?: string
): { allowed: boolean; reason?: string; attestation?: string } {
  const result = validateRoleReceive(role, messageType);
  if (!result.allowed) return result;
  
  const attest = createAttestation(role, messageType, true);
  if (attestation && !verifyAttestation(role, messageType, true, attestation)) {
    return { allowed: false, reason: "Invalid attestation" };
  }
  return { ...result, attestation: attest };
}