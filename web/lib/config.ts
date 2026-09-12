/**
 * Runtime configuration.
 *
 * Fetched from the API on boot rather than baked into the build, so the same
 * image can run against any project. Optional NEXT_PUBLIC_* for local only.
 */
export type ClientConfig = {
  supabaseUrl: string;
  supabasePublishableKey: string;
  apiBase: string;
};

export async function loadConfig(): Promise<ClientConfig> {
  const apiBase =
    (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_BASE_URL) ||
    "";

  const envUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const envKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
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
