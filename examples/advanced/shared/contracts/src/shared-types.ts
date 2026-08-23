/**
 * Cross-cutting domain types used by event payloads and MFE UI code.
 *
 * These are NOT topic contracts — they don't have a `name`/`payload`/
 * `examples` shape and don't participate in codegen. They live here purely
 * because both event contract files (`src/domains/**`) and MFE consumers
 * need them, and duplicating the same type in two places is worse than
 * one shared file.
 *
 * Rule of thumb: add here only types that (a) appear inside more than one
 * event payload OR (b) are referenced by non-event MFE code (rendering,
 * hooks, state). Everything else stays local to its event contract file.
 */

/** A menu dish, referenced by `ui.menu-item-opened.v1` payload and by storefront UI. */
export type MenuNutrition = {
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
};

export type MenuItem = {
  id: number;
  name: string;
  price: string;
  previewUrl: string;
  description: string;
  nutrition: MenuNutrition;
};

/** A cart line item, referenced by `cart.snapshot.v1`, `cart.checkout-requested.v1` and by cart/storefront UI. */
export type CartItem = {
  itemId: number;
  name: string;
  price: string;
  quantity: number;
};

/** Notification severity, referenced by `notification.show.v1` payload and by the toast UI component. */
export type NotificationKind = 'success' | 'info' | 'warn' | 'error';
