/// <reference types="expo/types" />

declare namespace NodeJS {
  interface ProcessEnv {
    readonly EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
    readonly EXPO_PUBLIC_SUPABASE_URL?: string;
  }
}

declare const process: { readonly env: NodeJS.ProcessEnv };
