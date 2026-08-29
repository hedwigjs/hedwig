/**
 * English translations for menu items (indexed by MenuItem.id).
 *
 * Russian versions live in `data.ts` and are the canonical source; this
 * file mirrors them for the `en` locale and gets consulted by helpers
 * below when `getLang() === 'en'`.
 */

import type { MenuItem } from '@hedwig-demo/contracts';

import { getLang } from '../../../shared/i18n/useLang';

type Translation = { name: string; description: string };

const EN: Record<number, Translation> = {
  1: {
    name: 'Moroccan Chicken Shawarma',
    description:
      'Tender chicken fillet in Moroccan spices, fresh vegetables and sauce in a thin flatbread. Served warm.',
  },
  2: {
    name: 'Greek Salad',
    description:
      'Classic mix with feta, olives, cucumbers and tomatoes. Dressed with olive oil and oregano.',
  },
  3: {
    name: 'Chaban Salad',
    description:
      'A hearty salad with boiled meat, potatoes, pickles and green peas.',
  },
  4: {
    name: 'Chicken Thigh Skewer',
    description:
      'Chicken-thigh pieces grilled to a golden crust. Served with onion and fresh herbs.',
  },
  5: {
    name: 'Lebanese Hummus',
    description:
      'Silky chickpea paste with tahini, lemon and garlic. Perfect with flatbread or veggie sticks.',
  },
  6: {
    name: 'Turkey Breast Skewer',
    description:
      'Lean marinated turkey — tender inside, lightly charred outside.',
  },
  7: {
    name: 'Khinkali with Veal',
    description:
      'Classic dumplings filled with aromatic veal and spices. Served hot with black pepper.',
  },
  8: {
    name: 'Adjarian Khachapuri',
    description:
      'Dough boat with sulguni cheese, egg and butter — mix the filling while hot.',
  },
  9: {
    name: 'Muhammara',
    description:
      'Red-pepper and walnut paste with warm spices. Served with flatbread, ~225 g.',
  },
  10: {
    name: 'Falafel with Tahini',
    description:
      'Crisp chickpea-and-herb balls with tahini sauce. Vegetarian hot starter, ~245 g.',
  },
  11: {
    name: 'Beet Hummus',
    description:
      'Delicate hummus with roasted beet and spices. Vivid color, mild flavor, ~160 g.',
  },
  12: {
    name: 'Veal Chebureki',
    description:
      'Thin dough with juicy veal-and-onion filling. Fried to a crackling crust.',
  },
};

export function localizedName(item: MenuItem): string {
  return getLang() === 'en' ? EN[item.id]?.name ?? item.name : item.name;
}

export function localizedDescription(item: MenuItem): string {
  return getLang() === 'en'
    ? EN[item.id]?.description ?? item.description
    : item.description;
}
