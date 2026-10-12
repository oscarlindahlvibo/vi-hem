import type { WOStatus } from '../types';

/** Only the default New state is promoted. Explicit choices always win. */
export function assignedWorkOrderStatus(status: WOStatus, assigneeIds: string[], explicitStatus = false): WOStatus {
  return status === 'new' && assigneeIds.length > 0 && !explicitStatus ? 'assigned' : status;
}
