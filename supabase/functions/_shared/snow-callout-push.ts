import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
/** Recheck just before contacting APNs/FCM, including messages queued before a decline. */
export async function snowCalloutPushAllowed(db:SupabaseClient,notification:{id:string;link?:string|null}) {
 if(notification.link!=='snow')return true;
 const {data,error}=await db.rpc('vihem_snow_push_allowed',{p_notification:notification.id});
 if(error)throw Error('SNOW_PUSH_STATE_UNAVAILABLE');
 return data===true;
}
