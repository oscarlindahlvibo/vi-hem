export function normalizeGuestMessage(message: any, unit: any, organisationId: string) {
  // Refuse upstream rows for any other room, even when the API ignores a filter.
  if (String(message.roomId) !== String(unit.beds24_room_id)) return null;
  if (unit.beds24_property_id && String(message.propertyId) !== String(unit.beds24_property_id)) return null;
  if (!/^\d+$/.test(String(message.id)) || !/^\d+$/.test(String(message.bookingId))) return null;
  const time = new Date(message.time);
  if (!message.time || !Number.isFinite(time.getTime())) throw new Error('Beds24-meddelandet saknar giltig tid.');
  if (!['guest', 'host', 'internalNote', 'system'].includes(message.source)) throw new Error('Okänd meddelandetyp från Beds24.');
  return {
    organisation_id: organisationId,
    unit_id: unit.id,
    beds24_message_id: String(message.id),
    beds24_booking_id: String(message.bookingId),
    source: message.source,
    message: String(message.message || ''),
    sent_at: time.toISOString(),
    beds24_read: typeof message.read === 'boolean' ? message.read : null,
    attachment_name: message.attachmentName || (message.attachment ? 'bilaga' : null),
    attachment_mime_type: message.attachmentMimeType || null,
    attachment_base64: message.attachment || null,
    synced_at: new Date().toISOString(),
  };
}

export async function fetchRoomMessages(token: string, unit: any, consume: (rows: any[]) => Promise<void>, fetcher = fetch) {
  let page = 1;
  const seenPages = new Set<number>();
  while (true) {
    if (seenPages.has(page) || seenPages.size >= 1000) throw new Error('Beds24 gav en ogiltig sidindelning.');
    seenPages.add(page);
    const params = new URLSearchParams({ roomId: String(unit.beds24_room_id), page: String(page) });
    if (unit.beds24_property_id) params.set('propertyId', String(unit.beds24_property_id));
    const response = await fetcher(`https://api.beds24.com/v2/bookings/messages?${params}`, {
      headers: { accept: 'application/json', token }, signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('Beds24 saknar åtkomst till gästmeddelanden. Anslutningen behöver läsbehörigheten bookings-personal.');
      throw new Error(`Kunde inte hämta gästmeddelanden (Beds24 ${response.status}).`);
    }
    const result = await response.json();
    if (!Array.isArray(result.data)) throw new Error('Beds24 returnerade ett oväntat meddelandesvar.');
    await consume(result.data);
    if (!result.pages?.nextPageExists) break;
    page++;
  }
}
