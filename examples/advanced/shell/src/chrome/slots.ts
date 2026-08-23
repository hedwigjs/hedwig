export type SlotName =
  | 'storefront'
  | 'cart-panel'
  | 'cart-header'
  | 'ai-chat'
  | 'notifications'
  | 'checkout';

/**
 * Every MFE mounts into a slot. The slot host is a `<section>` created by
 * `renderChrome`; the mount node is a `<div>` we insert inside it — so the
 * MFE can wipe its own subtree on unmount without touching the placeholder.
 */
export function ensureSlot(slot: SlotName): HTMLElement {
  const host = document.querySelector<HTMLElement>(`[data-slot-host="${slot}"]`);
  if (!host) throw new Error(`Slot host not found: ${slot}`);

  let mount = host.querySelector<HTMLElement>(':scope > [data-slot-mount]');
  if (!mount) {
    mount = document.createElement('div');
    mount.dataset.slotMount = slot;
    mount.className = `hdw-slot hdw-slot--${slot}`;
    host.appendChild(mount);
  }
  return mount;
}

export function getMountNode(slot: SlotName): HTMLElement {
  return ensureSlot(slot);
}
