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