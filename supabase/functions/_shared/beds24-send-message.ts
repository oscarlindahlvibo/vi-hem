// A failed/ambiguous response is never retried automatically: Beds24 has no documented idempotency key.
export async function sendGuestMessage(token: string, bookingId: string, message: string, fetcher = fetch): Promise<'sent' | 'failed' | 'pending'> {
  try {
    const response = await fetcher('https://api.beds24.com/v2/bookings/messages', {
      method: 'POST', headers: { token, accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify([{ bookingId: Number(bookingId), message }]), signal: AbortSignal.timeout(25000),
    });
    if ([401, 403, 429].includes(response.status)) return 'failed';
    if (!response.ok) return 'pending';
    const result = await response.json();
    if (!Array.isArray(result) || result.length !== 1) return 'pending';
    if (result[0].success === true) return 'sent';
    // success:false can mean partial success in Beds24; don't risk a second delivery.
    return 'pending';
  } catch { return 'pending'; }
}
export function acceptsChannelMessages(booking: any) {
  return ['booking', 'airbnb', 'expedia', 'agoda'].includes(String(booking.channel || '').toLowerCase());
}
