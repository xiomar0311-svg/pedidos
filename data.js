/**
 * CARTA OFICIAL DE SOCARRATT VALENCIAN FOOD
 * Sincronizada al 100% con https://socarratt.com/carta/
 */
const MENU_DATA = [
  // ==========================================================================
  // CARTA DE LA TIERRA
  // ==========================================================================
  {
    id: "paella-valenciana",
    name: "Paella Valenciana",
    category: "tierra",
    sectionTitle: "Carta de la Tierra",
    badge: "Carta de la Tierra",
    description: "Símbolo de la gastronomía española. Destaca por su sabor equilibrado y su arraigo cultural, es un imprescindible socarratt.",
    ingredients: "Pollo, conejo, judías verdes, garrofón, alcachofa y romero en rama.",
    extraVersionInfo: "Versión Castellón: Con pollo y costilla de cerdo.",
    includes: "Elegir el horario de entrega según disponibilidad, servicio a domicilio gratuito y recogida de la paella.",
    image: "https://socarratt.com/wp-content/uploads/2020/08/74523CDF-FA22-4045-AEA5-44FCBEE27027-768x884.png",
    characterImage: "https://socarratt.com/wp-content/uploads/2025/07/personaje_paella-valenciana-600x911.png",
    allergenImage: "https://socarratt.com/wp-content/uploads/2025/07/sin_gluten-150x150.png",
    basePrice6p: 115,
    extraPersonPrice: 15,
    prices: { 6: 115, 7: 130, 8: 145, 9: 160, 10: 175 },
    versions: ["Paella Valenciana", "Paella Valenciana (Versión Castellón)"]
  },
  {
    id: "paella-abuela",
    name: "Paella de la Abuela",
    category: "tierra",
    sectionTitle: "Carta de la Tierra",
    badge: "Carta de la Tierra",
    description: "Inspirada en una receta más Alicantina, con carácter, pero sobre todo para los amantes de mezclar legumbres con arroz.",
    ingredients: "Costilla de cerdo, garbanzos y pimiento rojo.",
    includes: "Elegir el horario de entrega según disponibilidad, servicio a domicilio gratuito y recogida de la paella.",
    image: "https://socarratt.com/wp-content/uploads/2025/07/paella_abuela-768x811.png",
    characterImage: "https://socarratt.com/wp-content/uploads/2025/07/personaje_paella-de-la-abuela-600x1534.png",
    allergenImage: "https://socarratt.com/wp-content/uploads/2025/07/sin_gluten-150x150.png",
    basePrice6p: 115,
    extraPersonPrice: 15,
    prices: { 6: 115, 7: 130, 8: 145, 9: 160, 10: 175 }
  },
  {
    id: "paella-rustica",
    name: "Paella Rústica",
    category: "tierra",
    sectionTitle: "Carta de la Tierra",
    badge: "Éxito en Ventas",
    description: "Una invención nuestra para las personas que buscan comer carne sin tanto tropezón, el justo y necesario. Es todo un éxito en ventas.",
    ingredients: "Costilla ligeramente adobada, pollo y champiñón.",
    includes: "Elegir el horario de entrega según disponibilidad, servicio a domicilio gratuito y recogida de la paella.",
    image: "https://socarratt.com/wp-content/uploads/2025/07/rustica-768x766.png",
    characterImage: "https://socarratt.com/wp-content/uploads/2025/07/personaje_paella-rustica-600x1303.png",
    allergenImage: "https://socarratt.com/wp-content/uploads/2025/07/sin_gluten-150x150.png",
    basePrice6p: 115,
    extraPersonPrice: 15,
    prices: { 6: 115, 7: 130, 8: 145, 9: 160, 10: 175 }
  },
  {
    id: "paella-carmelita",
    name: "Paella Carmelita",
    category: "tierra",
    sectionTitle: "Carta de la Tierra",
    badge: "Carta de la Tierra",
    description: "Una paella singular, la cerveza y las hierbas le dan un perfil aromático y sabroso, ideal para paladares más arriesgados.",
    ingredients: "Pollo, costilla de cerdo, judía verde, tomate confitado, garrofón, cerveza sin gluten, romero en rama y mezcla de hierbas provenzales.",
    includes: "Elegir el horario de entrega según disponibilidad, servicio a domicilio gratuito y recogida de la paella.",
    image: "https://socarratt.com/wp-content/uploads/2025/07/carmelita-768x747.png",
    characterImage: "https://socarratt.com/wp-content/uploads/2025/07/personaje_paella-castellon-600x1342.png",
    allergenImage: "https://socarratt.com/wp-content/uploads/2025/07/sin_gluten-150x150.png",
    basePrice6p: 115,
    extraPersonPrice: 15,
    prices: { 6: 115, 7: 130, 8: 145, 9: 160, 10: 175 }
  },
  {
    id: "paella-verduras",
    name: "Paella de Verduras",
    category: "tierra",
    sectionTitle: "Carta de la Tierra",
    badge: "100% Verduras",
    description: "Nuestra mejor opción ligera y rica en sabor gracias a su sofrito con verduras frescas y naturales. Ideal para los que buscan una opción sabrosa sin carne ni pescado.",
    ingredients: "Calabacín, berenjena, champiñón y pimiento rojo.",
    includes: "Elegir el horario de entrega según disponibilidad, servicio a domicilio gratuito y recogida de la paella.",
    image: "https://socarratt.com/wp-content/uploads/2025/07/verduras-768x762.png",
    characterImage: "https://socarratt.com/wp-content/uploads/2025/07/personaje_paella-de-verduras-600x1510.png",
    allergenImage: "https://socarratt.com/wp-content/uploads/2025/07/sin_gluten-150x150.png",
    basePrice6p: 115,
    extraPersonPrice: 15,
    prices: { 6: 115, 7: 130, 8: 145, 9: 160, 10: 175 }
  },
  {
    id: "arroz-al-horno",
    name: "Arroz al Horno",
    category: "tierra",
    sectionTitle: "Carta de la Tierra",
    badge: "Cazuela de Barro",
    description: "Tradición y sabor contundente. Horneado hasta lograr una capa superior ligeramente crujiente. Su aroma es profundo y su presentación en cazuela de barro. En Valencia un favorito.",
    ingredients: "Costilla de cerdo, panceta, morcilla valenciana oreada, patata, garbanzo, ajo, tomate y caldo de cocido.",
    includes: "Elegir el horario de entrega según disponibilidad, servicio a domicilio gratuito y recogida de la paella.",
    image: "https://socarratt.com/wp-content/uploads/2025/07/horno-768x727.png",
    characterImage: "https://socarratt.com/wp-content/uploads/2025/07/personaje_arroz-al-horno-600x1118.png",
    allergenImage: "https://socarratt.com/wp-content/uploads/2025/07/sin_gluten-150x150.png",
    basePrice6p: 121,
    extraPersonPrice: 16,
    prices: { 6: 121, 7: 137, 8: 153, 9: 169, 10: 185 }
  },

  // ==========================================================================
  // CARTA DEL MAR
  // ==========================================================================
  {
    id: "arroz-a-banda",
    name: "Arroz a Banda",
    category: "mar",
    sectionTitle: "Carta del Mar",
    badge: "Carta del Mar",
    description: "Simplicidad exquisita. Arroz que no solo alimenta, sino que conecta con la tradición marinera del levante español. Otro de nuestros imprescindibles.",
    ingredients: "Sepia, calamar y fondo de marisco.",
    includes: "Elegir el horario de entrega según disponibilidad, servicio a domicilio gratuito, recogida de la paella y tarrina de alioli grande.",
    image: "https://socarratt.com/wp-content/uploads/2025/07/banda-768x778.png",
    characterImage: "https://socarratt.com/wp-content/uploads/2025/07/personaje_arroz-a-banda-600x1282.png",
    allergenImage: "https://socarratt.com/wp-content/uploads/2025/09/alergenos5-300x94.png",
    basePrice6p: 115,
    extraPersonPrice: 15,
    prices: { 6: 115, 7: 130, 8: 145, 9: 160, 10: 175 }
  },
  {
    id: "arroz-negro",
    name: "Arroz Negro",
    category: "mar",
    sectionTitle: "Carta del Mar",
    badge: "Carta del Mar",
    description: "Mar profundo y sabor auténtico. Es un plato seductor, elegante, un poco transgresor. No es lo primero que pide quien duda, pero quien lo conoce lo busca.",
    ingredients: "Sepia, calamar en su tinta y fondo de marisco.",
    includes: "Elegir el horario de entrega según disponibilidad, servicio a domicilio gratuito, recogida de la paella y tarrina de alioli grande.",
    image: "https://socarratt.com/wp-content/uploads/2025/07/negro-768x739.png",
    characterImage: "https://socarratt.com/wp-content/uploads/2025/07/personaje_arroz-negro-600x1409.png",
    allergenImage: "https://socarratt.com/wp-content/uploads/2025/09/alergenos5-300x94.png",
    basePrice6p: 115,
    extraPersonPrice: 15,
    prices: { 6: 115, 7: 130, 8: 145, 9: 160, 10: 175 }
  },
  {
    id: "arroz-senoret",
    name: "Arroz al Señoret",
    category: "mar",
    sectionTitle: "Carta del Mar",
    badge: "Todo Pelado",
    description: "Es un plato que habla de placer sin esfuerzo, de sabores limpios del mar, sin tener que mancharse las manos. Elegancia sin esfuerzo. Sofisticación mediterránea.",
    ingredients: "Sepia, calamar, mejillón, cola de langostino y fondo de marisco.",
    includes: "Elegir el horario de entrega según disponibilidad, servicio a domicilio gratuito, recogida de la paella y tarrina de alioli grande.",
    image: "https://socarratt.com/wp-content/uploads/2025/07/senoret-768x778.png",
    characterImage: "https://socarratt.com/wp-content/uploads/2025/07/personaje_arroz-senoret-600x1415.png",
    allergenImage: "https://socarratt.com/wp-content/uploads/2025/07/alergenos2-300x69.png",
    basePrice6p: 115,
    extraPersonPrice: 15,
    prices: { 6: 115, 7: 130, 8: 145, 9: 160, 10: 175 }
  },
  {
    id: "a-banda-gambon",
    name: "A Banda con Gambón",
    category: "mar",
    sectionTitle: "Carta del Mar",
    badge: "Carta del Mar",
    description: "Comer un arroz a banda con gambón pelado evoca una fusión perfecta entre la tradición marinera más humilde y el refinamiento de lo esencial.",
    ingredients: "Sepia, calamar, gambón y fondo de marisco.",
    includes: "Elegir el horario de entrega según disponibilidad, servicio a domicilio gratuito, recogida de la paella y tarrina de alioli grande.",
    image: "https://socarratt.com/wp-content/uploads/2025/07/banda_gambon-768x771.png",
    characterImage: "https://socarratt.com/wp-content/uploads/2025/07/personaje_arroz-con-gambon-600x1319.png",
    allergenImage: "https://socarratt.com/wp-content/uploads/2025/07/alergenos2-300x69.png",
    basePrice6p: 121,
    extraPersonPrice: 16,
    prices: { 6: 121, 7: 137, 8: 153, 9: 169, 10: 185 }
  },
  {
    id: "arroz-turia",
    name: "Arroz del Turia",
    category: "mar",
    sectionTitle: "Carta del Mar",
    badge: "Tierra y Costa",
    description: "Mediterráneo dual: tierra y costa. Comer un arroz del Túria de Socarratt evoca una experiencia inmersiva en lo mejor de la cocina valenciana, con un guiño al alma de la huerta y el mar.",
    ingredients: "Sepia, calamar, alcachofa, gambón pelado y fondo de marisco.",
    includes: "Elegir el horario de entrega según disponibilidad, servicio a domicilio gratuito, recogida de la paella y tarrina de alioli grande.",
    image: "https://socarratt.com/wp-content/uploads/2025/07/turia-768x779.png",
    characterImage: "https://socarratt.com/wp-content/uploads/2025/07/personaje_arroz-del-turia-600x1965.png",
    allergenImage: "https://socarratt.com/wp-content/uploads/2025/07/alergenos2-300x69.png",
    basePrice6p: 121,
    extraPersonPrice: 16,
    prices: { 6: 121, 7: 137, 8: 153, 9: 169, 10: 185 }
  },
  {
    id: "fideua",
    name: "Fideuá",
    category: "mar",
    sectionTitle: "Carta del Mar",
    badge: "Carta del Mar",
    description: "Mar en cada fideo. Es como una versión juguetona de la paella que, en lugar de arroz, te sorprende con esos fideos dorados y sabrosos que absorben todo el carácter del mar.",
    ingredients: "Sepia, calamar, mejillón, cola de langostino, fideo y fondo de marisco.",
    extraVersionInfo: "Versión Fideuá Negra: Sepia, calamar, mejillón, cola de langostino, tinta de calamar, fideo y fondo de marisco.",
    includes: "Elegir el horario de entrega según disponibilidad, servicio a domicilio gratuito, recogida de la paella y tarrina de alioli grande.",
    image: "https://socarratt.com/wp-content/uploads/2025/07/fideua-768x753.png",
    characterImage: "https://socarratt.com/wp-content/uploads/2025/07/personaje_fideua-600x1341.png",
    allergenImage: "https://socarratt.com/wp-content/uploads/2025/07/alergenos3-300x69.png",
    basePrice6p: 115,
    extraPersonPrice: 15,
    prices: { 6: 115, 7: 130, 8: 145, 9: 160, 10: 175 },
    versions: ["Fideuá", "Fideuá Negra"]
  }
];

// Catálogo rápido plano de todas las variedades para el selector de cocina
const OFFICIAL_RICE_LIST = [
  { id: "paella-valenciana", name: "Paella Valenciana", base6p: 115, extraPx: 15 },
  { id: "paella-valenciana-castellon", name: "Paella Valenciana (Versión Castellón)", base6p: 115, extraPx: 15 },
  { id: "paella-abuela", name: "Paella de la Abuela", base6p: 115, extraPx: 15 },
  { id: "paella-rustica", name: "Paella Rústica", base6p: 115, extraPx: 15 },
  { id: "paella-carmelita", name: "Paella Carmelita", base6p: 115, extraPx: 15 },
  { id: "paella-verduras", name: "Paella de Verduras", base6p: 115, extraPx: 15 },
  { id: "arroz-al-horno", name: "Arroz al Horno", base6p: 121, extraPx: 16 },
  { id: "arroz-a-banda", name: "Arroz a Banda", base6p: 115, extraPx: 15 },
  { id: "arroz-negro", name: "Arroz Negro", base6p: 115, extraPx: 15 },
  { id: "arroz-senoret", name: "Arroz al Señoret", base6p: 115, extraPx: 15 },
  { id: "a-banda-gambon", name: "A Banda con Gambón", base6p: 121, extraPx: 16 },
  { id: "arroz-turia", name: "Arroz del Turia", base6p: 121, extraPx: 16 },
  { id: "fideua", name: "Fideuá", base6p: 115, extraPx: 15 },
  { id: "fideua-negra", name: "Fideuá Negra", base6p: 115, extraPx: 15 }
];

function getOfficialPaellaPrice(riceName, people) {
  const px = Number(people) || 6;
  const found = OFFICIAL_RICE_LIST.find(
    (r) => r.name.toLowerCase() === String(riceName || "").toLowerCase()
  );
  const base6p = found ? found.base6p : 115;
  const extraPx = found ? found.extraPx : 15;
  return base6p + Math.max(0, px - 6) * extraPx;
}
