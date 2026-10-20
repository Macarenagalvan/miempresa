import { createHandler } from './handler.mjs';

Deno.serve(createHandler({
  supabaseUrl: Deno.env.get('SUPABASE_URL'),
  publishableKey: Deno.env.get('MACA_PUBLISHABLE_KEY'),
  clientId: Deno.env.get('MACA_OAUTH_CLIENT_ID'),
  resourceUrl: Deno.env.get('MACA_MCP_RESOURCE_URL'),
  appUrl: Deno.env.get('MACA_APP_URL'),
}));
