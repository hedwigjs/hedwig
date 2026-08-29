import { useEffect, useState } from 'react';

import type { MenuItem } from '@hedwig-demo/contracts';

import { menuMock } from '../data';

/**
 * Loads the menu.
 *
 * TODO: swap the mock for an HTTP fetch once the backend service is in place.
 */
export function useMenu() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setItems(menuMock);
      setLoading(false);
    }, 150);
    return () => clearTimeout(timer);
  }, []);

  return { items, loading, error };
}
