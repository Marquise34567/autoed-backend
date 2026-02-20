export function createServerClient(..._args: any[]) {
  // Supabase removed — return a minimal stub compatible with call sites
  return {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
    },
    fromRequest: () => ({
      getSession: async () => ({ data: { session: null }, error: null }),
    }),
    // allow any method access
    any: () => null,
  } as any;
}

export default { createServerClient } as any;
