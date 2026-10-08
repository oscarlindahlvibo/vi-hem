import { supabase } from "./supabase";
export * from "./chatCore";
export async function chatRpc<T = unknown>(
  name: string,
  body: Record<string, unknown>,
): Promise<T> {
  const controller = new AbortController(),
    timer = window.setTimeout(() => controller.abort(), 20000);
  try {
    const { data, error } = await supabase
      .rpc(name, body)
      .abortSignal(controller.signal);
    if (error)
      throw new Error(
        controller.signal.aborted
          ? "Anslutningen tog för lång tid. Försök igen; samma meddelande publiceras inte två gånger."
          : error.message || "Åtgärden misslyckades.",
      );
    return data as T;
  } finally {
    window.clearTimeout(timer);
  }
}
