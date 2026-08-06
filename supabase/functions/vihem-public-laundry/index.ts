import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Action = 'get' | 'book' | 'cancel';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isExpired(link: any) {
  const today = localDateKey();
  if (!link.active) return true;
  if (link.valid_from && link.valid_from > today) return true;
  if (link.valid_until && link.valid_until < today) return true;
  return false;
}

function cleanText(value: unknown, fallback = '') {
  return String(value || fallback).trim().slice(0, 160);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const serviceClient = createClient(supabaseUrl, serviceKey);

    const url = new URL(req.url);
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const action = (body.action || url.searchParams.get('action') || 'get') as Action;
    const token = cleanText(body.token || url.searchParams.get('token'));

    if (!token) return json({ error: 'Saknar gästlänk.' }, 400);

    const { data: link, error: linkError } = await serviceClient
      .from('vihem_laundry_guest_links')
      .select(`
        *,
        property:vihem_properties(id, name, address),
        apartment:vihem_apartments(id, apartment_number),
        short_stay_unit:vihem_short_stay_units(id, name)
      `)
      .eq('token', token)
      .maybeSingle();

    if (linkError) throw linkError;
    if (!link || isExpired(link)) return json({ error: 'Länken är inte aktiv.' }, 404);

    const loadState = async () => {
      const today = new Date();
      const startDate = localDateKey(today);
      const endDate = localDateKey(addDays(today, 20));

      const { data: rooms, error: roomsError } = await serviceClient
        .from('vihem_laundry_rooms')
        .select('*')
        .eq('organisation_id', link.organisation_id)
        .eq('property_id', link.property_id)
        .eq('active', true)
        .order('name');

      if (roomsError) throw roomsError;
      const roomIds = (rooms || []).map((room: any) => room.id);

      let slots: any[] = [];
      let bookings: any[] = [];
      if (roomIds.length) {
        const { data: slotsData, error: slotsError } = await serviceClient
          .from('vihem_laundry_slots')
          .select('*')
          .in('laundry_room_id', roomIds)
          .gte('date', startDate)
          .lte('date', endDate)
          .order('date')
          .order('start_time');
        if (slotsError) throw slotsError;
        slots = slotsData || [];

        const slotIds = slots.map((slot: any) => slot.id);
        if (slotIds.length) {
          const { data: bookingsData, error: bookingsError } = await serviceClient
            .from('vihem_laundry_bookings')
            .select('id, laundry_slot_id, guest_link_id, status')
            .in('laundry_slot_id', slotIds)
            .eq('status', 'active');
          if (bookingsError) throw bookingsError;
          bookings = bookingsData || [];
        }
      }

      const activeOwnBookings = bookings.filter((booking: any) => booking.guest_link_id === link.id).length;
      const slotsWithStatus = slots.map((slot: any) => {
        const booking = bookings.find((item: any) => item.laundry_slot_id === slot.id);
        return {
          ...slot,
          is_booked: Boolean(booking),
          own_booking_id: booking?.guest_link_id === link.id ? booking.id : null,
        };
      });

      return {
        link: {
          id: link.id,
          label: link.label,
          max_bookings: link.max_bookings,
          active_bookings: activeOwnBookings,
          property: link.property,
          apartment: link.apartment,
          short_stay_unit: link.short_stay_unit,
        },
        rooms: rooms || [],
        slots: slotsWithStatus,
      };
    };

    if (action === 'book') {
      const slotId = cleanText(body.slot_id);
      const guestName = cleanText(body.guest_name, 'Gäst');
      const guestEmail = cleanText(body.guest_email);
      const guestPhone = cleanText(body.guest_phone);

      if (!slotId) return json({ error: 'Välj en tvättid.' }, 400);

      const { data: activeBookings, error: activeError } = await serviceClient
        .from('vihem_laundry_bookings')
        .select('id')
        .eq('guest_link_id', link.id)
        .eq('status', 'active');
      if (activeError) throw activeError;
      if ((activeBookings || []).length >= link.max_bookings) {
        return json({ error: `Max ${link.max_bookings} aktiva bokningar är redan gjorda med denna länk.` }, 409);
      }

      const { data: slot, error: slotError } = await serviceClient
        .from('vihem_laundry_slots')
        .select('*, laundry_room:vihem_laundry_rooms(id, property_id, organisation_id, active)')
        .eq('id', slotId)
        .maybeSingle();
      if (slotError) throw slotError;
      if (!slot || !slot.laundry_room?.active) return json({ error: 'Tvättiden finns inte längre.' }, 404);
      if (slot.laundry_room.property_id !== link.property_id || slot.laundry_room.organisation_id !== link.organisation_id) {
        return json({ error: 'Tvättiden hör inte till denna gästlänk.' }, 403);
      }
      if (slot.is_blocked) return json({ error: 'Tvättiden är blockerad.' }, 409);
      if (new Date(`${slot.date}T${slot.end_time}`).getTime() < Date.now()) {
        return json({ error: 'Tvättiden har redan passerat.' }, 409);
      }

      const { data: existingBooking, error: existingError } = await serviceClient
        .from('vihem_laundry_bookings')
        .select('id')
        .eq('laundry_slot_id', slot.id)
        .eq('status', 'active')
        .maybeSingle();
      if (existingError) throw existingError;
      if (existingBooking) return json({ error: 'Tvättiden är redan bokad.' }, 409);

      const { error: insertError } = await serviceClient
        .from('vihem_laundry_bookings')
        .insert({
          laundry_slot_id: slot.id,
          tenant_id: null,
          guest_link_id: link.id,
          guest_name: guestName,
          guest_email: guestEmail,
          guest_phone: guestPhone,
          status: 'active',
        });
      if (insertError) throw insertError;

      return json({ message: 'Bokningen är klar.', data: await loadState() });
    }

    if (action === 'cancel') {
      const bookingId = cleanText(body.booking_id);
      if (!bookingId) return json({ error: 'Saknar bokning.' }, 400);

      const { error: cancelError } = await serviceClient
        .from('vihem_laundry_bookings')
        .update({ status: 'cancelled' })
        .eq('id', bookingId)
        .eq('guest_link_id', link.id);
      if (cancelError) throw cancelError;

      return json({ message: 'Bokningen är avbokad.', data: await loadState() });
    }

    return json({ data: await loadState() });
  } catch (error) {
    console.error('vihem-public-laundry error:', error);
    return json({ error: error instanceof Error ? error.message : 'Något gick fel.' }, 500);
  }
});
