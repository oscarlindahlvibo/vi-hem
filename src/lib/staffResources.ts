export type Material = {
  id: string;
  name: string;
  code: string;
  barcode: string;
  qr: string;
  unit: string;
};
export type Equipment = {
  id: string;
  product_id: string;
  name: string;
  code: string;
  location: string;
};
export type ResourceCatalog = {
  materials: Material[];
  equipment: Equipment[];
  locations: { id: string; name: string }[];
  balances: { item_id: string; location_id: string; quantity: number }[];
  work_orders: { id: string; title: string }[];
};
export type MaterialLine = {
  item_id: string;
  location_id: string;
  quantity: number;
};
export type EquipmentLine = {
  asset_id: string;
  product_id: string;
  start_at: string;
  end_at: string;
};
export type Reservation = {
  id: string;
  name: string;
  actor_id: string;
  work_order_id: string | null;
  start_at: string;
  end_at: string;
  status: "reserved" | "picked_up" | "returned" | "cancelled";
};
export type ResourceHistory = {
  reservations: Reservation[];
  materials: {
    id: string;
    name: string;
    quantity: number;
    unit: string;
    created_at: string;
  }[];
};
export const emptyCatalog: ResourceCatalog = {
  materials: [],
  equipment: [],
  locations: [],
  balances: [],
  work_orders: [],
};
export const dateInput = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
export function matchResourceCode(catalog: ResourceCatalog, raw: string) {
  const code = raw.trim();
  let item = "",
    asset = "";
  if (code.startsWith("vihem:equipment:"))
    asset = code.slice("vihem:equipment:".length);
  if (code.startsWith("vihem:material:"))
    item = code.slice("vihem:material:".length);
  try {
    const url = new URL(code);
    item = url.searchParams.get("item") || item;
    asset = url.searchParams.get("asset") || asset;
  } catch {
    /* Plain EAN/internal identifier. */
  }
  return {
    materials: catalog.materials.filter(
      (x) =>
        x.id === item ||
        [x.barcode, x.qr, x.code].filter(Boolean).includes(code),
    ),
    equipment: catalog.equipment.filter(
      (x) => x.id === asset || (!!x.code && x.code === code),
    ),
  };
}
export function resourceRequest(
  materials: MaterialLine[],
  equipment: EquipmentLine[],
  workOrder: string,
  notes: string,
) {
  return {
    p_materials: [...materials].sort((a, b) =>
      (a.item_id + a.location_id).localeCompare(b.item_id + b.location_id),
    ),
    p_equipment: [...equipment].sort((a, b) =>
      (a.asset_id + a.start_at).localeCompare(b.asset_id + b.start_at),
    ),
    p_work_order: workOrder || null,
    p_notes: notes.trim(),
  };
}
