import type { MenuItem } from '@hedwig-demo/contracts';

/**
 * Local demo fixture: menu of Hedwig Café.
 *
 * Not a topic contract — just the seed data the menu MFE renders when
 * there is no real menu API to call. In a real deployment this would come
 * from `GET /menu` on the backend and this constant would disappear.
 *
 * Lives here (not in `@hedwig-demo/contracts`) because a fixture is the
 * menu MFE's concern, not part of the topic registry. The registry only
 * describes `MenuItem` as a shared payload/model type.
 */
export const menuMock: MenuItem[] = [
  {
    id: 1,
    name: 'Мароканская шаурма c курицей',
    price: '1470 ₽',
    previewUrl:
      'https://eda.yandex/images/3507668/ca1ce979ffe479d0cba87facdec04784-300x300.jpeg',
    description:
      'Нежное куриное филе в мароканских специях, свежие овощи и соус в тонком лаваше. Подаётся тёплой.',
    nutrition: { caloriesKcal: 520, proteinG: 28, fatG: 22, carbsG: 48 },
  },
  {
    id: 2,
    name: 'Салат Греческий',
    price: '1890 ₽',
    previewUrl:
      'https://eda.yandex/images/15475554/d035b4b05fcc46578b8953ef641a7770-300x300.jpeg',
    description:
      'Классический микс с фетой, оливками, огурцами и помидорами. Заправка из оливкового масла и орегано.',
    nutrition: { caloriesKcal: 280, proteinG: 12, fatG: 22, carbsG: 14 },
  },
  {
    id: 3,
    name: 'Салат Чабан',
    price: '1450 ₽',
    previewUrl:
      'https://eda.yandex/images/13802765/7a69f73c6820268b682dee21301eecdb-400x400nocrop.jpeg',
    description:
      'Сытный салат с отварным мясом, картофелем, маринованными огурцами и зелёным горошком.',
    nutrition: { caloriesKcal: 340, proteinG: 18, fatG: 24, carbsG: 22 },
  },
  {
    id: 4,
    name: 'Шашлык из куриного бедра',
    price: '1490 ₽',
    previewUrl:
      'https://eda.yandex/images/14549513/a8407fa6361650f6d1277f741c92f7bd-400x400nocrop.jpeg',
    description:
      'Кусочки бедра на мангале до золотистой корочки. Подаются с луком и свежей зеленью.',
    nutrition: { caloriesKcal: 310, proteinG: 32, fatG: 18, carbsG: 4 },
  },
  {
    id: 5,
    name: 'Хумус ливанский',
    price: '690 ₽',
    previewUrl:
      'https://eda.yandex/images/3525402/6db027b04ea890529365110a55d55172-400x400nocrop.jpeg',
    description:
      'Нежная паста из нута с тахини, лимоном и чесноком. Идеально с лепёшкой или овощными палочками.',
    nutrition: { caloriesKcal: 240, proteinG: 8, fatG: 14, carbsG: 20 },
  },
  {
    id: 6,
    name: 'Шашлык из грудки индейки',
    price: '1590 ₽',
    previewUrl:
      'https://eda.yandex/images/15305317/6416caf6a2a74f1b84b05bc91e52dc1b-400x400nocrop.jpeg',
    description:
      'Постный шашлык из маринованной индейки — мягкий внутри и с лёгкой корочкой снаружи.',
    nutrition: { caloriesKcal: 265, proteinG: 38, fatG: 10, carbsG: 3 },
  },
  {
    id: 7,
    name: 'Хинкали с телятиной',
    price: '1420 ₽',
    previewUrl:
      'https://eda.yandex/images/15377433/56d76ea814fb4cdbb28ced216b25b90b-400x400nocrop.jpeg',
    description:
      'Классические хинкали с ароматным фаршем из телятины и специями. Подаются горячими с перцем.',
    nutrition: { caloriesKcal: 380, proteinG: 22, fatG: 14, carbsG: 42 },
  },
  {
    id: 8,
    name: 'Хачапури по-аджарски',
    price: '890 ₽',
    previewUrl:
      'https://eda.yandex/images/3506804/65481d8feb3a0d8c6fd076aeac47f0ae-400x400.jpeg',
    description:
      'Лодочка из теста с сыром сулугуни, яйцом и маслом — пока горячий, размешать начинку.',
    nutrition: { caloriesKcal: 620, proteinG: 28, fatG: 38, carbsG: 42 },
  },
  {
    id: 9,
    name: 'Мухаммара',
    price: '690 ₽',
    previewUrl:
      'https://eda.yandex/images/3439028/ee50f1532c783d461ad03618c9cbd550-400x400.jpeg',
    description:
      'Паста из перцев и грецких орехов с пряностями. Подаётся с лепёшкой, порция ~225 г.',
    nutrition: { caloriesKcal: 320, proteinG: 6, fatG: 22, carbsG: 26 },
  },
  {
    id: 10,
    name: 'Фалафель с тахини',
    price: '590 ₽',
    previewUrl:
      'https://eda.yandex/images/3502490/2bd17ae838d82a9cbad29c9b6ad179e4-400x400.jpeg',
    description:
      'Хрустящие шарики из нута и зелени с соусом тахини. Вегетарианская горячая закуска, ~245 г.',
    nutrition: { caloriesKcal: 420, proteinG: 14, fatG: 22, carbsG: 42 },
  },
  {
    id: 11,
    name: 'Хумус свекольный',
    price: '550 ₽',
    previewUrl:
      'https://eda.yandex/images/3502728/6ea01b47941dc6687d1fbd1429f12815-400x400.jpeg',
    description:
      'Нежный хумус с запечённой свёклой и специями. Яркий цвет и мягкий вкус, ~160 г.',
    nutrition: { caloriesKcal: 220, proteinG: 7, fatG: 12, carbsG: 22 },
  },
  {
    id: 12,
    name: 'Чебурёк с телятиной',
    price: '690 ₽',
    previewUrl:
      'https://eda.yandex/images/3806315/f98f47cc0ad215bb60480c019c561d76-400x400.jpeg',
    description:
      'Тонкое тесто с сочным фаршем из телятины и луком. Обжаривается до хрустящей корочки.',
    nutrition: { caloriesKcal: 380, proteinG: 18, fatG: 22, carbsG: 32 },
  },
];
