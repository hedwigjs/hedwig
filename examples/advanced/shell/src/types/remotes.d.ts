/**
 * Ambient type declarations for Module Federation remotes.
 *
 * Each MFE exposes a single entry `./App` with single-spa lifecycle
 * exports. Types are declared here so the shell can `import()` them
 * without ts-loader complaining about the virtual module URL.
 */

declare module 'storefront/App' {
  export const bootstrap: (props: unknown) => Promise<void>;
  export const mount: (props: unknown) => Promise<void>;
  export const unmount: (props: unknown) => Promise<void>;
}

declare module 'cart/App' {
  export const bootstrap: (props: unknown) => Promise<void>;
  export const mount: (props: unknown) => Promise<void>;
  export const unmount: (props: unknown) => Promise<void>;
}

declare module 'ai_chat/App' {
  export const bootstrap: (props: unknown) => Promise<void>;
  export const mount: (props: unknown) => Promise<void>;
  export const unmount: (props: unknown) => Promise<void>;
}

declare module 'notifications/App' {
  export const bootstrap: (props: unknown) => Promise<void>;
  export const mount: (props: unknown) => Promise<void>;
  export const unmount: (props: unknown) => Promise<void>;
}
