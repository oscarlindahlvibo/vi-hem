import type { WorkOrder } from '../types';
export type TimeWorkOrder = Pick<WorkOrder, 'id' | 'title' | 'status' | 'customer_project_id'>;
// Match the active tab in WorkOrdersPage: waiting and ready-for-check
// orders are still open work, regardless of whom they are assigned to.
export async function listTimeWorkOrders(client: any, organisationId?: string | null): Promise<TimeWorkOrder[]> {
  const rows: TimeWorkOrder[] = [];
  for (let offset = 0; ; offset += 500) {
    let query = client.from('vihem_work_orders').select('id, title, status, customer_project_id')
      .not('status', 'in', '(completed,cancelled)');
    if (organisationId) query = query.eq('organisation_id', organisationId);
    const { data, error } = await query.order('title').order('id').range(offset, offset + 499);
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < 500) return rows;
  }
}
