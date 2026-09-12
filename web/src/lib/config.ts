/**
 * Runtime configuration.
 *
 * Fetched from the API on boot rather than inlined by Vite, so the same built
 * image can run against any project without rebuilding. Falls back to VITE_*
 * variables for local development.
 */
export type ClientConfig = {
  supabaseUrl: string;
  supabasePublishableKey: string;
  apiBase: string;
};

export async function loadConfig(): Promise<ClientConfig> {
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string) ?? "";

  const envUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const envKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (envUrl && envKey) {
    return { supabaseUrl: envUrl, supabasePublishableKey: envKey, apiBase };
  }

  const response = await fetch(`${apiBase}/api/config`);
  if (!response.ok) {
    throw new Error(`Could not load configuration (${response.status})`);
  }
  const body = await response.json();
  if (!body.supabase_url || !body.supabase_publishable_key) {
    throw new Error("The server returned an incomplete configuration.");
  }
  return {
    supabaseUrl: body.supabase_url,
    supabasePublishableKey: body.supabase_publishable_key,
    apiBase,
  };
}
