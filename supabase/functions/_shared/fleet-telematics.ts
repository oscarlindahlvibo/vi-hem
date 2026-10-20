// Traccar speed is knots; odometer/obdOdometer are metres. Missing is never zero.
export function normalizeTraccar(input: Record<string, unknown>) {
  const position = input.position as Record<string, unknown>;
  const device = input.device as Record<string, unknown>;
  if (!position || !device || !/^\d{15}$/.test(String(device.uniqueId || "")))
    throw Error("INVALID_DEVICE");
  if (
    position.protocol !== "teltonika" ||
    !Number.isSafeInteger(position.id) ||
    Number(position.id) <= 0
  )
    throw Error("INVALID_PROTOCOL_OR_ID");
  const num = (v: unknown, min: number, max: number): number | null =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max
      ? v
      : null;
  const bool = (v: unknown) => (typeof v === "boolean" ? v : null);
  const attributes = (position.attributes || {}) as Record<string, unknown>;
  const time = (v: unknown) => {
    if (
      typeof v !== "string" ||
      !/(Z|[+-]\d\d:\d\d)$/.test(v) ||
      !Number.isFinite(Date.parse(v))
    )
      throw Error("INVALID_TIME");
    const stamp = new Date(v);
    if (stamp.getTime() > Date.now() + 300000 || stamp.getUTCFullYear() < 2020)
      throw Error("INVALID_TIME");
    return stamp.toISOString();
  };
  const valid = position.valid === true;
  const latitude = num(position.latitude, -90, 90),
    longitude = num(position.longitude, -180, 180);
  if (
    valid &&
    (latitude === null ||
      longitude === null ||
      (latitude === 0 && longitude === 0))
  )
    throw Error("INVALID_COORDINATES");
  const model = String(device.model || "").toUpperCase();
  // FMC003 OEM AVL 389 is kilometres; Traccar 6.16 only maps it automatically for FMB003.
  const oemKm = /^(FMC003|FMB003|FMM003)$/.test(model)
    ? num(attributes.io389, 0, 1e7)
    : null;
  const measured =
    oemKm !== null ? oemKm * 1000 : num(attributes.obdOdometer, 0, 1e10);
  const estimated = num(attributes.odometer, 0, 1e10);
  return {
    imei: String(device.uniqueId),
    message_id: `traccar:${position.id}:${time(position.fixTime)}`,
    recorded_at: time(position.fixTime),
    received_at: time(position.serverTime),
    gps_valid: valid,
    latitude: valid ? latitude : null,
    longitude: valid ? longitude : null,
    speed_kmh:
      valid && num(position.speed, 0, 270) !== null
        ? Number(position.speed) * 1.852
        : null,
    heading: valid ? num(position.course, 0, 360) : null,
    ignition: bool(attributes.ignition),
    odometer:
      measured !== null
        ? measured / 1000
        : estimated !== null
          ? estimated / 1000
          : null,
    odometer_source:
      measured !== null
        ? "obd_measured"
        : estimated !== null
          ? "gps_estimated"
          : null,
    engine_rpm: num(attributes.rpm, 0, 20000),
    fuel_level_pct: num(attributes.fuelLevel, 0, 100),
    battery_voltage: num(attributes.power, 0, 100),
    backup_battery_voltage: num(attributes.battery, 0, 20),
    engine_hours:
      num(attributes.hours, 0, 1e12) === null
        ? null
        : Number(attributes.hours) / 3600000,
    signal_quality: num(attributes.rssi, 0, 5),
  };
}
