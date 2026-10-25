/**
 * LÓGICA DEL PANEL DE COCINA, EXPEDICIÓN Y RADAR GPS DE REPARTIDORES - SOCARRATT
 * Obrador Central: Calle Manuela Malasaña, 5 (Madrid) -> Coordenadas: [40.4288, -3.7042]
 * Ciclo de Rondas: Sale Cocina (ej. 13:00) -> Entrega Cliente (~13:30) -> Regreso al Local para ronda +1h (14:00)
 */

const OBRADOR_COORDS = { lat: 40.4288, lng: -3.7042, address: "Calle Manuela Malasaña, 5 (Madrid)" };
const PUBLIC_TUNNEL_BASE = "https://xiomar0311-svg.github.io/pedidos";
const LOCAL_WIFI_BASE = "http://192.168.1.41:8080";
let mobileQrMode = "tunnel";

function isLocalhostEnv() {
  const h = window.location.hostname;
  return !h || h === "localhost" || h === "127.0.0.1" || h.startsWith("192.168.");
}

function getActiveMobileBaseUrl() {
  if (mobileQrMode === "wifi") return LOCAL_WIFI_BASE;
  if (window.location.hostname.includes("github.io")) {
    return "https://xiomar0311-svg.github.io/pedidos";
  }
  return window.SOCARRATT_TUNNEL_URL || PUBLIC_TUNNEL_BASE;
}
const MQTT_STATE_TOPIC = "socarratt/madrid/malasana5/state_v3";
const MQTT_PATCH_TOPIC = "socarratt/madrid/malasana5/patch_v3";
const MQTT_RIDER_GPS_WILDCARD = "socarratt/madrid/malasana5/rider_gps/+";
const myKdsClientId = "socarratt_kds_" + Math.random().toString(16).slice(2, 10);

// Franjas horarias de salida de cocina (cada media hora de 13:00 a 16:00)
const KITCHEN_SLOTS = ["13:00", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00"];

const liveChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("socarratt_live_channel") : null;
let mqttClient = null;
let lastServerSeq = 0;
const processedPatchIds = new Set();

// Control de qué pedidos están plegados (vista compacta: paella, calle y precio)
const collapsedTicketsSet = new Set();
let allCollapsedMode = false;

// ============================================================================
// UTILIDADES DE FECHAS DEL CALENDARIO (YYYY-MM-DD)
// ============================================================================
function getIsoDateOffset(daysOffset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getUpcomingDayOfWeekIso(targetDay) {
  const d = new Date();
  const currentDay = d.getDay();
  let diff = (targetDay - currentDay + 7) % 7;
  d.setDate(d.getDate() + diff);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeOrderDate(rawDate) {
  if (!rawDate || rawDate === "today") return getIsoDateOffset(0);
  if (rawDate === "tomorrow") return getIsoDateOffset(1);
  return rawDate;
}

function formatHumanDate(isoStr) {
  if (!isoStr || isoStr === "all") return "Todas las fechas programadas";
  const todayIso = getIsoDateOffset(0);
  const tomorrowIso = getIsoDateOffset(1);

  const parts = isoStr.split("-");
  if (parts.length !== 3) return isoStr;
  const dateObj = new Date(Number(parts[0]), Number(parts[1] - 1), Number(parts[2]));
  const formatted = dateObj.toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long"
  });
  const cap = formatted.charAt(0).toUpperCase() + formatted.slice(1);

  if (isoStr === todayIso) return `${cap} (Hoy)`;
  if (isoStr === tomorrowIso) return `${cap} (Mañana)`;
  return cap;
}

function formatShortDateBadge(isoStr) {
  const norm = normalizeOrderDate(isoStr);
  const todayIso = getIsoDateOffset(0);
  const tomorrowIso = getIsoDateOffset(1);
  if (norm === todayIso) return "Hoy";
  if (norm === tomorrowIso) return "Mañana";
  const parts = norm.split("-");
  if (parts.length !== 3) return norm;
  const d = new Date(Number(parts[0]), Number(parts[1] - 1), Number(parts[2]));
  return d.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
}

// ============================================================================
// BASE DE DATOS GEOGRÁFICA DE MADRID PARA CÁLCULO DE KM, IDA+SUBIR Y VUELTA
// ============================================================================
const MADRID_ZONES_DB = [
  { keywords: ["fuencarral", "malasaña", "manuela malasaña", "bilbao", "carranza", "28004", "san bernardo", "tribunal"], zone: "Malasaña / Centro Norte", lat: 40.4265, lng: -3.7018, vehicle: "bike", outboundMin: 16, returnMin: 9 },
  { keywords: ["chueca", "san marcos", "hortaleza", "barquillo", "libertad", "infantas"], zone: "Chueca / Justicia", lat: 40.4226, lng: -3.6975, vehicle: "bike", outboundMin: 18, returnMin: 10 },
  { keywords: ["santa engracia", "viriato", "chamberí", "chamberi", "almagro", "trafalgar", "28010", "olavide", "ponzano", "rios rosas", "ríos rosas", "28003"], zone: "Chamberí / Almagro", lat: 40.4352, lng: -3.7002, vehicle: "bike", outboundMin: 19, returnMin: 11 },
  { keywords: ["argüelles", "arguelles", "princesa", "moncloa", "arapiles", "28015", "alberto aguilera", "gaztambide", "islas filipinas"], zone: "Argüelles / Arapiles", lat: 40.4310, lng: -3.7145, vehicle: "bike", outboundMin: 20, returnMin: 12 },
  { keywords: ["serrano", "velázquez", "velazquez", "goya", "salamanca", "28001", "28006", "claudio coello", "lista", "príncipe de vergara"], zone: "Barrio de Salamanca", lat: 40.4275, lng: -3.6835, vehicle: "bike", outboundMin: 24, returnMin: 14 },
  { keywords: ["sol", "gran vía", "gran via", "callao", "ópera", "opera", "mayor", "28013", "centro", "prensa"], zone: "Sol / Gran Vía", lat: 40.4188, lng: -3.7055, vehicle: "bike", outboundMin: 21, returnMin: 13 },
  { keywords: ["lavapiés", "lavapies", "atocha", "embajadores", "28012", "huertas", "las letras", "28014", "cortes"], zone: "Cortes / Lavapiés / Atocha", lat: 40.4115, lng: -3.6995, vehicle: "bike", outboundMin: 25, returnMin: 15 },
  { keywords: ["retiro", "ibiza", "menéndez pelayo", "menendez pelayo", "28009", "narváez", "narvaez", "alfonso xii"], zone: "Retiro / Ibiza", lat: 40.4180, lng: -3.6765, vehicle: "bike", outboundMin: 25, returnMin: 15 },
  { keywords: ["príncipe pío", "principe pio", "debod", "ferraz", "28008", "bailén", "palacio"], zone: "Moncloa / Ferraz / P. Pío", lat: 40.4220, lng: -3.7185, vehicle: "bike", outboundMin: 22, returnMin: 13 },
  { keywords: ["castellana", "chamartín", "chamartin", "28036", "28046", "cuzco", "plaza castilla", "bernabéu", "bernabeu", "nuevos ministerios"], zone: "Paseo Castellana / Chamartín", lat: 40.4585, lng: -3.6895, vehicle: "car", outboundMin: 29, returnMin: 19 },
  { keywords: ["alcalá", "alcala", "ventas", "28028", "guindalera", "manuel becerra", "francisco silvela", "diego de león"], zone: "Ventas / Guindalera", lat: 40.4315, lng: -3.6630, vehicle: "car", outboundMin: 28, returnMin: 18 },
  { keywords: ["cuatro caminos", "tetuán", "tetuan", "bravo murillo", "28020", "orense", "azca"], zone: "Tetuán / AZCA", lat: 40.4495, lng: -3.7030, vehicle: "car", outboundMin: 26, returnMin: 16 },
  { keywords: ["pirámides", "piramides", "arganzuela", "toledo", "imperial", "28005", "delicias", "legazpi", "28045"], zone: "Arganzuela / Madrid Río", lat: 40.4015, lng: -3.7060, vehicle: "car", outboundMin: 27, returnMin: 17 },
  { keywords: ["arturo soria", "hortaleza", "28033", "28043", "ciudad lineal", "28027", "prosperidad", "28002", "avenida de américa"], zone: "Prosperidad / Arturo Soria", lat: 40.4460, lng: -3.6660, vehicle: "car", outboundMin: 30, returnMin: 20 }
];

const DEFAULT_RIDERS = [
  {
    id: "rider-bici-1",
    name: "Dani (Bici 1)",
    vehicle: "bike",
    phone: "34611223301",
    lat: 40.4258,
    lng: -3.7018,
    gpsActive: false
  },
  {
    id: "rider-bici-2",
    name: "Álex (Bici 2)",
    vehicle: "bike",
    phone: "34611223302",
    lat: 40.4288,
    lng: -3.7042,
    gpsActive: false
  },
  {
    id: "rider-bici-3",
    name: "Javi (Bici 3)",
    vehicle: "bike",
    phone: "34611223303",
    lat: 40.4288,
    lng: -3.7042,
    gpsActive: false
  },
  {
    id: "rider-coche-1",
    name: "Marcos (Coche 1)",
    vehicle: "car",
    phone: "34611223304",
    lat: 40.4480,
    lng: -3.6930,
    gpsActive: false
  },
  {
    id: "rider-coche-2",
    name: "Roberto (Coche 2)",
    vehicle: "car",
    phone: "34611223305",
    lat: 40.4288,
    lng: -3.7042,
    gpsActive: false
  },
  {
    id: "rider-1792700056526",
    name: "XIOMAR",
    vehicle: "bike",
    phone: "34607169903",
    lat: 40.4288,
    lng: -3.7042,
    gpsActive: false
  }
];

function buildInitialDemoOrders() {
  const now = Date.now();
  const todayIso = getIsoDateOffset(0);
  const tomorrowIso = getIsoDateOffset(1);
  const satIso = getUpcomingDayOfWeekIso(6);

  return [
    {
      id: "ord-101",
      clientName: "Carlos Menéndez",
      clientPhone: "622 145 890",
      slot: "13:00",
      date: todayIso,
      type: "delivery_whole",
      vehicle: "car",
      riderId: "rider-coche-1",
      address: "Paseo de la Castellana 184, 6º B (Chamartín)",
      lat: 40.4585,
      lng: -3.6895,
      distanceKm: 3.6,
      outboundMinutes: 29,
      returnMinutes: 19,
      items: [
        { name: "Paella Valenciana Tradicional", format: "Paella grande para 8 personas", highlight: "🥘 Paella grande (8p)", option: "Socarrat tostado", notes: "Llevar cambio de 50€ • 6º B" }
      ],
      total: 145.00,
      status: "returning",
      departedAt: now - 49 * 60 * 1000,
      deliveredToClientAt: now - 23 * 60 * 1000,
      deliveryProof: "Entregado en mano a Carlos M. (6º B)",
      returnedToStoreAt: null
    },
    {
      id: "ord-102",
      clientName: "Laura Gómez",
      clientPhone: "610 998 342",
      slot: "13:30",
      date: todayIso,
      type: "delivery_portions",
      vehicle: "bike",
      riderId: "rider-bici-1",
      address: "Calle Fuencarral 88, 3º D (Malasaña - 28004)",
      lat: 40.4252,
      lng: -3.7012,
      distanceKm: 0.7,
      outboundMinutes: 16,
      returnMinutes: 9,
      items: [
        { name: "Arroz al Senyoret", format: "3 raciones individuales", highlight: "🍽️ 3 raciones", option: "Socarrat tostado", notes: "Timbre 3º D" }
      ],
      total: 40.50,
      status: "en_route",
      departedAt: now - 11 * 60 * 1000,
      deliveredToClientAt: null,
      deliveryProof: "",
      returnedToStoreAt: null
    },
    {
      id: "ord-103",
      clientName: "Ignacio Vega",
      clientPhone: "654 220 119",
      slot: "14:00",
      date: todayIso,
      type: "pickup",
      vehicle: "pickup",
      riderId: "",
      address: "Recoge en Obrador (Manuela Malasaña 5)",
      lat: 40.4288,
      lng: -3.7042,
      distanceKm: 0,
      outboundMinutes: 0,
      returnMinutes: 0,
      items: [
        { name: "Arroz al Horno (Arròs al Forn)", format: "Paella grande para 6 personas", highlight: "🥘 Paella grande (6p)", option: "Punto al horno", notes: "" }
      ],
      total: 115.00,
      status: "cooking"
    },
    {
      id: "ord-104",
      clientName: "Marta Ruiz",
      clientPhone: "687 431 002",
      slot: "14:00",
      date: todayIso,
      type: "delivery_portions",
      vehicle: "bike",
      riderId: "rider-1792700056526",
      address: "Calle Santa Engracia 45, 1º Izq (Chamberí - 28010)",
      lat: 40.4348,
      lng: -3.6992,
      distanceKm: 1.1,
      outboundMinutes: 19,
      returnMinutes: 11,
      items: [
        { name: "Paella Valenciana", format: "2 raciones", highlight: "🍽️ 2 raciones", option: "Punto estándar" },
        { name: "Arroz Negro", format: "2 raciones", highlight: "🍽️ 2 raciones", option: "Con alioli" }
      ],
      total: 52.00,
      status: "ready"
    },
    {
      id: "ord-105",
      clientName: "Familia Sotomayor",
      clientPhone: "691 800 234",
      slot: "14:00",
      date: todayIso,
      type: "delivery_whole",
      vehicle: "car",
      riderId: "rider-coche-1",
      address: "Calle Alcalá 212, 4º A (Ventas - 28028)",
      lat: 40.4315,
      lng: -3.6630,
      distanceKm: 3.7,
      outboundMinutes: 28,
      returnMinutes: 18,
      items: [
        { name: "Paella de Marisco Marinera", format: "Paella grande para 10 personas", highlight: "🥘 Paella grande (10p)", option: "Socarrat tostado", notes: "Tocar al timbre 4º A" }
      ],
      total: 175.00,
      status: "cooking"
    },
    {
      id: "ord-106",
      clientName: "Elena Garrido",
      clientPhone: "644 512 908",
      slot: "14:00",
      date: tomorrowIso,
      type: "delivery_whole",
      vehicle: "bike",
      riderId: "",
      address: "Calle Serrano 62, 2º Izq (Salamanca - 28001)",
      lat: 40.4275,
      lng: -3.6835,
      distanceKm: 2.1,
      outboundMinutes: 24,
      returnMinutes: 14,
      items: [
        { name: "Arroz al Senyoret", format: "Paella grande para 7 personas", highlight: "🥘 Paella grande (7p)", option: "Socarrat tostado", notes: "Reserva para mañana" }
      ],
      total: 130.00,
      status: "pending"
    },
    {
      id: "ord-107",
      clientName: "Cumpleaños Familia Peña",
      clientPhone: "677 301 445",
      slot: "14:30",
      date: satIso,
      type: "delivery_whole",
      vehicle: "car",
      riderId: "",
      address: "Calle Arturo Soria 140 (Hortaleza - 28043)",
      lat: 40.4460,
      lng: -3.6660,
      distanceKm: 4.4,
      outboundMinutes: 30,
      returnMinutes: 20,
      items: [
        { name: "Paella Valenciana Tradicional", format: "Paella grande para 10 personas", highlight: "🥘 Paella grande (10p)", option: "Socarrat tostado", notes: "Llevar 2 tarrinas grandes de alioli" }
      ],
      total: 175.00,
      status: "pending"
    }
  ];
}

// Estado global del KDS
const kdsState = {
  orders: [],
  riders: [],
  selectedFilterDate: getIsoDateOffset(0),
  fleetPanelVisible: true,
  mapExpanded: false,
  gpsSimActive: false,
  gpsSimInterval: null
};

let kdsMap = null;
let currentTileLayer = null;
let obradorMarker = null;
let bikeRadiusCircle = null;
const riderMarkersDict = {};
const riderLinesDict = {};
const destMarkersDict = {};
let isUserDraggingMap = false;

// ============================================================================
// CÁLCULO DE DISTANCIA, TIEMPO DE IDA (+SUBIR) Y VUELTA DESDE MANUELA MALASAÑA 5
// Calibrado con distancias y tiempos reales de Google Maps Madrid:
// - Centro / interior M-30 (ej. Fósforo 8 -> 3.8 km, 12 min coche / 14 min bici)
// - Exterior / M-30 (ej. Metro Alsacia -> 9.1 km, 14 min coche / 34 min bici)
// ============================================================================
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const straightKm = R * c;
  if (straightKm <= 0.05) return 0;

  // En el centro de Madrid (<3 km en línea recta, rodeando Palacio Real / Gran Vía / sentidos únicos)
  // el factor de rodeo callejero real es ~1.57x (ej. Fósforo 8: 2.415 km recta -> 3.8 km reales).
  // En distancias largas (>5 km en línea recta por avenidas/M-30) el rodeo baja a ~1.31x (ej. Alsacia: 6.94 km -> 9.1 km).
  let roadFactor;
  if (straightKm <= 2.6) {
    roadFactor = 1.57;
  } else if (straightKm >= 6.5) {
    roadFactor = 1.31;
  } else {
    const t = (straightKm - 2.6) / (6.5 - 2.6);
    roadFactor = 1.57 - t * (1.57 - 1.31);
  }

  return Math.round(straightKm * roadFactor * 10) / 10;
}

function calculateMadridTravelTimes(distKm, vehicle = "bike") {
  if (!distKm || distKm <= 0.1) {
    return { carMin: 1, bikeMin: 1, motoMin: 1, activeMin: 1, summaryText: "En el local" };
  }

  // Coche en Madrid:
  // - Hasta 4.0 km (tráfico urbano centro con semáforos y calles de 30 km/h): ~3.15 min/km
  //   -> Ej: Calle del Fósforo 8 (3.8 km) = 3.8 * 3.15 = 12 min exactos
  // - Más de 4.0 km (salida a M-30 / grandes avenidas a 70-90 km/h): +0.42 min por km adicional
  //   -> Ej: Metro Alsacia (9.1 km) = 12 + (5.1 * 0.42) = 14 min exactos
  let carMin;
  if (distKm <= 4.0) {
    carMin = Math.max(3, Math.round(distKm * 3.15));
  } else {
    carMin = Math.round(12.0 + (distKm - 4.0) * 0.42);
  }

  // Bici en Madrid (~16.2 km/h reales con semáforos = 3.7 min/km)
  // -> Ej: Fósforo 8 (3.8 km) = 14 min | Metro Alsacia (9.1 km) = 34 min exactos
  const bikeMin = Math.max(2, Math.round(distKm * 3.7));

  // Moto en Madrid
  const motoMin = Math.max(2, Math.round(carMin * 0.78));

  const activeMin = vehicle === "car" ? carMin : vehicle === "moto" ? motoMin : bikeMin;
  const summaryText =
    vehicle === "car"
      ? `🚗 ${carMin} min (🚲 ${bikeMin}m)`
      : vehicle === "moto"
      ? `🛵 ${motoMin} min (🚗 ${carMin}m)`
      : `🚲 ${bikeMin} min (🚗 ${carMin}m)`;

  return { carMin, bikeMin, motoMin, activeMin, summaryText };
}

function estimateMadridRoute(address, isPickup = false) {
  if (isPickup || !address || address.toLowerCase().includes("recoge en obrador")) {
    return {
      zone: "Recogida en Obrador",
      vehicle: "pickup",
      lat: OBRADOR_COORDS.lat,
      lng: OBRADOR_COORDS.lng,
      distanceKm: 0,
      outboundMinutes: 0,
      returnMinutes: 0
    };
  }

  const clean = address.toLowerCase();
  const matched = MADRID_ZONES_DB.find((z) => z.keywords.some((kw) => clean.includes(kw)));

  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = (hash << 5) - hash + clean.charCodeAt(i);
  }
  const jitterLat = ((hash % 100) / 100) * 0.0028;
  const jitterLng = (((hash >> 4) % 100) / 100) * 0.0028;

  if (matched) {
    const lat = matched.lat + jitterLat;
    const lng = matched.lng + jitterLng;
    const dist = Math.max(0.5, haversineKm(OBRADOR_COORDS.lat, OBRADOR_COORDS.lng, lat, lng));
    return {
      zone: matched.zone,
      vehicle: matched.vehicle,
      lat,
      lng,
      distanceKm: dist,
      outboundMinutes: matched.outboundMin,
      returnMinutes: matched.returnMin
    };
  }

  const fallbackLat = OBRADOR_COORDS.lat + ((hash % 100) / 100) * 0.022;
  const fallbackLng = OBRADOR_COORDS.lng + (((hash >> 3) % 100) / 100) * 0.025;
  const dist = Math.max(2.2, haversineKm(OBRADOR_COORDS.lat, OBRADOR_COORDS.lng, fallbackLat, fallbackLng));
  return {
    zone: "Madrid Capital (Ruta Coche)",
    vehicle: "car",
    lat: fallbackLat,
    lng: fallbackLng,
    distanceKm: dist,
    outboundMinutes: 28,
    returnMinutes: 18
  };
}

// ============================================================================
// UTILIDADES DE RONDAS DE 30 MIN Y +1 HORA (13:00 -> 13:30 -> 14:00)
// ============================================================================
function addMinutesToSlot(slotStr, minutesToAdd) {
  if (!slotStr || !slotStr.includes(":")) return "";
  const [hh, mm] = slotStr.split(":").map(Number);
  const totalMin = hh * 60 + mm + minutesToAdd;
  const nH = Math.floor(totalMin / 60);
  const nM = totalMin % 60;
  return `${String(nH).padStart(2, "0")}:${String(nM).padStart(2, "0")}`;
}

function formatClockTime(timestampMs) {
  if (!timestampMs) return "--:--";
  const d = new Date(timestampMs);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function getOrderTelemetry(order) {
  const est = estimateMadridRoute(order.address, order.type === "pickup");
  const outboundBudget = order.outboundMinutes || est.outboundMinutes || 25;
  const returnBudget = order.returnMinutes || est.returnMinutes || 15;
  const distanceKm = order.distanceKm !== undefined ? order.distanceKm : est.distanceKm;
  const deliveryTargetSlot = addMinutesToSlot(order.slot, 30);
  const nextRoundSlot = addMinutesToSlot(order.slot, 60);

  const now = Date.now();
  let outboundElapsedMin = 0;
  let returnElapsedMin = 0;
  let semaphore = "idle";
  let semaphoreLabel = "En Cocina";
  let alertReason = "";
  let etaReturnStr = nextRoundSlot;

  if (order.status === "en_route") {
    const startMs = order.departedAt || now;
    outboundElapsedMin = Math.max(0, Math.floor((now - startMs) / 60000));
    const remainingOutbound = outboundBudget - outboundElapsedMin;
    const etaReturnMs = startMs + (outboundBudget + returnBudget) * 60000;
    etaReturnStr = formatClockTime(etaReturnMs);

    if (remainingOutbound >= 4) {
      semaphore = "green";
      semaphoreLabel = `🟢 En tiempo (Ida ${outboundElapsedMin}/${outboundBudget}m)`;
    } else if (remainingOutbound >= -2) {
      semaphore = "yellow";
      semaphoreLabel = `🟡 Entregando / Subiendo (${outboundElapsedMin}/${outboundBudget}m)`;
    } else {
      const delayMin = Math.abs(remainingOutbound);
      semaphore = "red";
      semaphoreLabel = `🔴 +${delayMin}m sin marcar Entregado`;
      alertReason = `Lleva ${outboundElapsedMin} min desde que salió (estimado ${outboundBudget} min) y NO ha pulsado "Entregado".`;
    }
  } else if (order.status === "returning") {
    const startMs = order.departedAt || now - 35 * 60000;
    const delivMs = order.deliveredToClientAt || now;
    outboundElapsedMin = Math.max(1, Math.round((delivMs - startMs) / 60000));
    returnElapsedMin = Math.max(0, Math.floor((now - delivMs) / 60000));
    const remainingReturn = returnBudget - returnElapsedMin;
    const etaReturnMs = delivMs + returnBudget * 60000;
    etaReturnStr = formatClockTime(etaReturnMs);

    if (remainingReturn >= 3) {
      semaphore = "green";
      semaphoreLabel = `🟢 Volviendo (${returnElapsedMin}/${returnBudget}m) • Llega ${etaReturnStr}`;
    } else if (remainingReturn >= -2) {
      semaphore = "yellow";
      semaphoreLabel = `🟡 Justo en vuelta (${returnElapsedMin}/${returnBudget}m)`;
    } else {
      const extraMin = Math.abs(remainingReturn);
      semaphore = "red";
      semaphoreLabel = `🔴 ¡RETRASO VUELTA +${extraMin}m!`;
      alertReason = `Ya entregó hace ${returnElapsedMin} min (vuelta estimada: ${returnBudget} min). Lleva +${extraMin} min extra sin llegar al local.`;
    }
  } else if (order.status === "delivered") {
    if (order.departedAt && order.deliveredToClientAt) {
      outboundElapsedMin = Math.max(1, Math.round((order.deliveredToClientAt - order.departedAt) / 60000));
    }
    if (order.deliveredToClientAt && order.returnedToStoreAt) {
      returnElapsedMin = Math.max(1, Math.round((order.returnedToStoreAt - order.deliveredToClientAt) / 60000));
    }
    semaphore = "green";
    semaphoreLabel = "✅ Ciclo Completado en Local";
  }

  return {
    distanceKm,
    outboundBudget,
    returnBudget,
    outboundElapsedMin,
    returnElapsedMin,
    deliveryTargetSlot,
    nextRoundSlot,
    semaphore,
    semaphoreLabel,
    alertReason,
    etaReturnStr
  };
}

// ============================================================================
// PERSISTENCIA Y SINCRONIZACIÓN EN TIEMPO REAL SIN CONFLICTO DE RELOJ
// ============================================================================
function loadKdsData() {
  const savedRiders = localStorage.getItem("socarratt_riders");
  if (savedRiders) {
    try {
      const parsedRiders = JSON.parse(savedRiders);
      kdsState.riders = parsedRiders.length > 0 ? parsedRiders : [...DEFAULT_RIDERS];
    } catch (e) {
      kdsState.riders = [...DEFAULT_RIDERS];
    }
  } else {
    kdsState.riders = [...DEFAULT_RIDERS];
    localStorage.setItem("socarratt_riders", JSON.stringify(kdsState.riders));
  }

  // Asegurar que XIOMAR esté en la lista si no estaba
  if (!kdsState.riders.some((r) => r.name.toUpperCase().includes("XIOMAR"))) {
    kdsState.riders.push({
      id: "rider-1792700056526",
      name: "XIOMAR",
      vehicle: "bike",
      phone: "34607169903",
      lat: 40.4288,
      lng: -3.7042,
      gpsActive: false
    });
  }

  const savedOrders = localStorage.getItem("socarratt_orders");
  if (savedOrders) {
    try {
      const parsed = JSON.parse(savedOrders);
      if (Array.isArray(parsed) && parsed.length > 0) {
        kdsState.orders = parsed.map((o) => {
          const est = estimateMadridRoute(o.address, o.type === "pickup");
          return {
            ...o,
            date: normalizeOrderDate(o.date),
            lat: o.lat || est.lat,
            lng: o.lng || est.lng,
            distanceKm: o.distanceKm !== undefined ? o.distanceKm : est.distanceKm,
            outboundMinutes: o.outboundMinutes || est.outboundMinutes,
            returnMinutes: o.returnMinutes || est.returnMinutes,
            riderId: o.riderId !== undefined ? o.riderId : ""
          };
        });
      } else {
        kdsState.orders = buildInitialDemoOrders();
      }
    } catch (e) {
      kdsState.orders = buildInitialDemoOrders();
    }
  } else {
    kdsState.orders = buildInitialDemoOrders();
    localStorage.setItem("socarratt_orders", JSON.stringify(kdsState.orders));
  }
}

// Aplica en el PC cualquier actualización de GPS o estado enviada desde el móvil de un repartidor
function applyMobileRiderPatch(patchData) {
  if (!patchData) return;
  if (patchData.patchId && processedPatchIds.has(patchData.patchId)) return;
  if (patchData.patchId) processedPatchIds.add(patchData.patchId);

  let updatedRiderId = null;

  if (patchData.patchRider) {
    const pr = patchData.patchRider;
    updatedRiderId = pr.id;
    const isGpsActive = pr.gpsActive !== undefined ? Boolean(pr.gpsActive) : true;
    const isOnShift = pr.onShift !== undefined ? Boolean(pr.onShift) : isGpsActive;
    const idx = kdsState.riders.findIndex((r) => r.id === pr.id || r.name === pr.name);
    if (idx > -1) {
      kdsState.riders[idx].lat = Number(pr.lat);
      kdsState.riders[idx].lng = Number(pr.lng);
      kdsState.riders[idx].gpsActive = isGpsActive;
      kdsState.riders[idx].onShift = isOnShift;
      if (pr.shiftTimeStr) kdsState.riders[idx].shiftTimeStr = pr.shiftTimeStr;
      kdsState.riders[idx].lastGpsUpdate = Date.now();
    } else {
      kdsState.riders.push({
        ...pr,
        lat: Number(pr.lat),
        lng: Number(pr.lng),
        gpsActive: isGpsActive,
        onShift: isOnShift,
        shiftTimeStr: pr.shiftTimeStr || formatClockTime(Date.now()),
        lastGpsUpdate: Date.now()
      });
    }
    localStorage.setItem("socarratt_riders", JSON.stringify(kdsState.riders));
  }

  if (patchData.patchOrder) {
    const po = patchData.patchOrder;
    const oIdx = kdsState.orders.findIndex((o) => o.id === po.id);
    if (oIdx > -1) {
      kdsState.orders[oIdx] = {
        ...kdsState.orders[oIdx],
        status: po.status || kdsState.orders[oIdx].status,
        departedAt: po.departedAt !== undefined ? po.departedAt : kdsState.orders[oIdx].departedAt,
        deliveredToClientAt: po.deliveredToClientAt !== undefined ? po.deliveredToClientAt : kdsState.orders[oIdx].deliveredToClientAt,
        deliveryProof: po.deliveryProof || kdsState.orders[oIdx].deliveryProof,
        returnedToStoreAt: po.returnedToStoreAt !== undefined ? po.returnedToStoreAt : kdsState.orders[oIdx].returnedToStoreAt
      };
      localStorage.setItem("socarratt_orders", JSON.stringify(kdsState.orders));
    }
  }

  // Actualizar el estado retenido en MQTT para que si el móvil recarga, reciba su propia ubicación actualizada
  if (mqttClient && mqttClient.connected) {
    mqttClient.publish(
      MQTT_STATE_TOPIC,
      JSON.stringify({ orders: kdsState.orders, riders: kdsState.riders }),
      { qos: 0, retain: true }
    );
  }

  renderAllKds();

  const syncEl = document.getElementById("gps-last-sync");
  if (syncEl && patchData.patchRider) {
    syncEl.textContent = `🛰️ GPS en vivo recibido de ${patchData.patchRider.name} (${formatClockTime(Date.now())}h)`;
  }

  // Si el repartidor acaba de mandar su ubicación desde el móvil, mover suavemente la cámara hacia él
  if (updatedRiderId && patchData.focusMap && kdsMap && riderMarkersDict[updatedRiderId]) {
    kdsMap.flyTo(riderMarkersDict[updatedRiderId].getLatLng(), 15, { duration: 0.6 });
    riderMarkersDict[updatedRiderId].openPopup();
  }
}

function broadcastStateToMobile() {
  const payload = JSON.stringify({
    senderId: myKdsClientId,
    orders: kdsState.orders,
    riders: kdsState.riders
  });

  if (liveChannel) {
    liveChannel.postMessage({ type: "SYNC_ALL" });
  }

  if (mqttClient && mqttClient.connected) {
    mqttClient.publish(MQTT_STATE_TOPIC, payload, { qos: 1, retain: true });
  }

  if (isLocalhostEnv()) {
    const apiEndpoint = window.location.protocol.startsWith("http")
      ? "/api/state"
      : "http://127.0.0.1:8080/api/state";
    fetch(apiEndpoint, {
      method: "POST",
      body: payload
    })
      .then((r) => r.json())
      .then((res) => {
        if (res && res.seq) lastServerSeq = res.seq;
      })
      .catch(() => {});
  }
}

function saveKdsOrders() {
  localStorage.setItem("socarratt_orders", JSON.stringify(kdsState.orders));
  localStorage.setItem("socarratt_has_custom_state", "1");
  broadcastStateToMobile();
}

function saveKdsRiders() {
  localStorage.setItem("socarratt_riders", JSON.stringify(kdsState.riders));
  localStorage.setItem("socarratt_has_custom_state", "1");
  broadcastStateToMobile();
}

function initRealtimeMobileSync() {
  // 1. MQTT WebSocket en tiempo real (funciona en la nube para iPad, PC y móviles sin necesitar servidor local)
  if (typeof mqtt !== "undefined") {
    try {
      mqttClient = mqtt.connect("wss://broker.emqx.io:8084/mqtt", {
        clientId: myKdsClientId,
        clean: true,
        connectTimeout: 4000,
        reconnectPeriod: 2500
      });

      mqttClient.on("connect", () => {
        mqttClient.subscribe(MQTT_PATCH_TOPIC, { qos: 1 });
        mqttClient.subscribe(MQTT_RIDER_GPS_WILDCARD, { qos: 1 });
        mqttClient.subscribe(MQTT_STATE_TOPIC, { qos: 1 });
        const syncEl = document.getElementById("gps-last-sync");
        if (syncEl) syncEl.textContent = "🟢 Radar Cloud (iPad / Móviles) Conectado en Vivo";
      });

      mqttClient.on("message", (topic, message) => {
        if (topic === MQTT_PATCH_TOPIC || topic.startsWith("socarratt/madrid/malasana5/rider_gps/")) {
          try {
            const patchData = JSON.parse(message.toString());
            applyMobileRiderPatch(patchData);
          } catch (err) {}
        } else if (topic === MQTT_STATE_TOPIC) {
          try {
            const stateData = JSON.parse(message.toString());
            if (stateData && stateData.senderId !== myKdsClientId) {
              if (Array.isArray(stateData.orders) && stateData.orders.length > 0) {
                kdsState.orders = stateData.orders.map((o) => ({ ...o, date: normalizeOrderDate(o.date) }));
                localStorage.setItem("socarratt_orders", JSON.stringify(kdsState.orders));
              }
              if (Array.isArray(stateData.riders) && stateData.riders.length > 0) {
                // Fusionar preservando cualquier GPS activo
                stateData.riders.forEach((incR) => {
                  const existing = kdsState.riders.find((r) => r.id === incR.id);
                  if (existing && (existing.gpsActive || existing.onShift) && !incR.gpsActive && !incR.onShift) {
                    incR.lat = existing.lat;
                    incR.lng = existing.lng;
                    incR.gpsActive = existing.gpsActive;
                    incR.onShift = existing.onShift;
                    incR.shiftTimeStr = existing.shiftTimeStr;
                  }
                });
                kdsState.riders = stateData.riders;
                localStorage.setItem("socarratt_riders", JSON.stringify(kdsState.riders));
              }
              renderAllKds();
            }
          } catch (err) {}
        }
      });
    } catch (e) {}
  }

  // 2. Sondeo al servidor local (solo si estamos en el PC local)
  if (isLocalhostEnv()) {
    setInterval(() => {
      const apiEndpoint = window.location.protocol.startsWith("http")
        ? "/api/state"
        : "http://127.0.0.1:8080/api/state";
      fetch(apiEndpoint)
        .then((r) => r.json())
        .then((data) => {
          if (!data || !data.seq) return;
          if (data.seq !== lastServerSeq) {
            lastServerSeq = data.seq;
            if (Array.isArray(data.riders)) {
              data.riders.forEach((srvR) => {
                const localR = kdsState.riders.find((r) => r.id === srvR.id);
                if (localR) {
                  if (srvR.gpsActive || srvR.onShift !== undefined || (srvR.lat && srvR.lng)) {
                    localR.lat = Number(srvR.lat);
                    localR.lng = Number(srvR.lng);
                    localR.gpsActive = Boolean(srvR.gpsActive);
                    localR.onShift = srvR.onShift !== undefined ? Boolean(srvR.onShift) : Boolean(srvR.gpsActive);
                    if (srvR.shiftTimeStr) localR.shiftTimeStr = srvR.shiftTimeStr;
                  }
                } else {
                  kdsState.riders.push(srvR);
                }
              });
              localStorage.setItem("socarratt_riders", JSON.stringify(kdsState.riders));
            }
            if (Array.isArray(data.orders) && data.orders.length > 0) {
              kdsState.orders = data.orders.map((o) => ({ ...o, date: normalizeOrderDate(o.date) }));
              localStorage.setItem("socarratt_orders", JSON.stringify(kdsState.orders));
            }
            renderAllKds();
            const syncEl = document.getElementById("gps-last-sync");
            if (syncEl) syncEl.textContent = `🛰️ Ubicación Móvil actualizada (${formatClockTime(Date.now())}h)`;
          }
        })
        .catch(() => {});
    }, 1500);
  }
}

// ============================================================================
// MODAL PARA CONECTAR EL MÓVIL (CÓDIGO QR + ENVIAR POR WHATSAPP)
// ============================================================================
function openMobileConnectModal() {
  updateMobileQrAndLinks();
  document.getElementById("mobile-connect-modal").classList.add("active");
}

function closeMobileConnectModal() {
  document.getElementById("mobile-connect-modal").classList.remove("active");
}

function updateMobileQrAndLinks() {
  const targetPath = document.getElementById("mobile-link-target")?.value || "/repartidor.html";
  const baseUrl = window.location.protocol.startsWith("http") && !window.location.hostname.includes("localhost") && !window.location.hostname.includes("127.0.0.1")
    ? window.location.origin
    : PUBLIC_TUNNEL_BASE;

  const fullUrl = `${baseUrl}${targetPath}`;
  const urlInput = document.getElementById("mobile-public-url-input");
  if (urlInput) urlInput.value = fullUrl;

  const qrImg = document.getElementById("mobile-qr-img");
  if (qrImg) {
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=6&data=${encodeURIComponent(fullUrl)}`;
  }

  const waBtn = document.getElementById("btn-send-wa-mobile");
  if (waBtn) {
    const msg = `🛵 *App de Repartidores y Cocina - Socarratt Madrid*\n\nPulsa en este enlace desde tu móvil para abrir la pantalla en tiempo real conectada con Cocina:\n👉 ${fullUrl}\n\n_(Enlace alternativo si estás en el Wi-Fi del local: http://192.168.1.41:8080${targetPath})_`;
    waBtn.href = `https://api.whatsapp.com/send?phone=34607169903&text=${encodeURIComponent(msg)}`;
  }

  broadcastStateToMobile();
}

function copyMobileUrl() {
  const input = document.getElementById("mobile-public-url-input");
  if (!input) return;
  input.select();
  navigator.clipboard?.writeText(input.value);
  alert("✅ Enlace copiado: " + input.value);
}

// ============================================================================
// SISTEMA DE FILTRADO Y NAVEGACIÓN POR CUALQUIER FECHA DEL CALENDARIO
// ============================================================================
function updateDateFilterUI() {
  const calendarInput = document.getElementById("kds-calendar-input");
  const labelEl = document.getElementById("active-date-label");

  const todayIso = getIsoDateOffset(0);
  const tomorrowIso = getIsoDateOffset(1);
  const satIso = getUpcomingDayOfWeekIso(6);
  const sunIso = getUpcomingDayOfWeekIso(0);

  if (calendarInput) {
    calendarInput.value = kdsState.selectedFilterDate === "all" ? todayIso : kdsState.selectedFilterDate;
  }

  const btnMap = {
    "qdate-today": kdsState.selectedFilterDate === todayIso,
    "qdate-tomorrow": kdsState.selectedFilterDate === tomorrowIso,
    "qdate-saturday": kdsState.selectedFilterDate === satIso,
    "qdate-sunday": kdsState.selectedFilterDate === sunIso,
    "qdate-all": kdsState.selectedFilterDate === "all"
  };

  Object.keys(btnMap).forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      if (btnMap[id]) el.classList.add("active");
      else el.classList.remove("active");
    }
  });

  if (labelEl) {
    const countForDate = getFilteredOrders().length;
    labelEl.innerHTML = `📅 <strong>${formatHumanDate(kdsState.selectedFilterDate)}</strong> <span style="background:#334155; color:#fff; padding:2px 8px; border-radius:999px; font-size:0.75rem;">${countForDate} ${countForDate === 1 ? "pedido" : "pedidos"}</span>`;
  }
}

function selectQuickDate(mode) {
  if (mode === "today") kdsState.selectedFilterDate = getIsoDateOffset(0);
  else if (mode === "tomorrow") kdsState.selectedFilterDate = getIsoDateOffset(1);
  else if (mode === "saturday") kdsState.selectedFilterDate = getUpcomingDayOfWeekIso(6);
  else if (mode === "sunday") kdsState.selectedFilterDate = getUpcomingDayOfWeekIso(0);
  else if (mode === "all") kdsState.selectedFilterDate = "all";

  updateDateFilterUI();
  renderAllKds();
}

function onCalendarDateChange(isoDateVal) {
  if (!isoDateVal) return;
  kdsState.selectedFilterDate = isoDateVal;
  updateDateFilterUI();
  renderAllKds();
}

function stepSelectedDate(deltaDays) {
  const baseIso = kdsState.selectedFilterDate === "all" ? getIsoDateOffset(0) : kdsState.selectedFilterDate;
  const parts = baseIso.split("-").map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  d.setDate(d.getDate() + deltaDays);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  kdsState.selectedFilterDate = `${yyyy}-${mm}-${dd}`;
  updateDateFilterUI();
  renderAllKds();
}

function getFilteredOrders() {
  return kdsState.orders.filter((o) => {
    const normDate = normalizeOrderDate(o.date);
    return kdsState.selectedFilterDate === "all" || normDate === kdsState.selectedFilterDate;
  });
}

// ============================================================================
// PLEGAR Y DESPLEGAR PEDIDOS (VISTA COMPACTA POR HORAS VS DETALLE COMPLETO)
// ============================================================================
function toggleTicketCollapse(orderId, event) {
  if (event) event.stopPropagation();
  if (collapsedTicketsSet.has(orderId)) {
    collapsedTicketsSet.delete(orderId);
  } else {
    collapsedTicketsSet.add(orderId);
  }
  renderKdsBoard();
}

function toggleAllTicketsCollapse() {
  allCollapsedMode = !allCollapsedMode;
  const btn = document.getElementById("btn-toggle-all-collapse");
  if (allCollapsedMode) {
    kdsState.orders.forEach((o) => collapsedTicketsSet.add(o.id));
    if (btn) btn.textContent = "↕️ Desplegar Todos los Pedidos";
  } else {
    collapsedTicketsSet.clear();
    if (btn) btn.textContent = "↕️ Plegar Todos (Vista Compacta)";
  }
  renderKdsBoard();
}

// ============================================================================
// INICIALIZACIÓN DEL PANEL DE COCINA
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {
  loadKdsData();
  updateDateFilterUI();
  initLiveGpsMap();
  renderAllKds();
  setupKdsListeners();
  initRealtimeMobileSync();

  setInterval(() => {
    renderFleetCards();
    renderKdsBoard();
    if (!isUserDraggingMap) {
      updateLiveMapMarkers();
    }
  }, 3000);
});

function renderAllKds() {
  updateDateFilterUI();
  renderFleetCards();
  renderKdsBoard();
  updateLiveMapMarkers();
}

// ============================================================================
// MAPA GPS CALLEJERO NÍTIDO DE MADRID (RESPETA SIEMPRE EL GPS REAL DEL MÓVIL)
// ============================================================================
const MAP_TILE_URLS = {
  google_streets: {
    url: "https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&hl=es",
    attribution: "&copy; Google Maps Callejero Madrid"
  },
  google_hybrid: {
    url: "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}&hl=es",
    attribution: "&copy; Google Maps Satélite + Calles"
  },
  esri_streets: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: "&copy; Esri World Street Map"
  },
  osm: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenStreetMap contributors"
  }
};

function initLiveGpsMap() {
  const mapEl = document.getElementById("kds-live-map");
  if (!mapEl || typeof L === "undefined") return;

  kdsMap = L.map("kds-live-map", {
    zoomControl: true,
    scrollWheelZoom: true,
    dragging: true,
    tap: true
  }).setView([OBRADOR_COORDS.lat, OBRADOR_COORDS.lng], 14);

  changeMapTileStyle("google_streets");

  kdsMap.on("dragstart zoomstart", () => {
    isUserDraggingMap = true;
  });
  kdsMap.on("dragend zoomend", () => {
    setTimeout(() => {
      isUserDraggingMap = false;
    }, 400);
  });

  bikeRadiusCircle = L.circle([OBRADOR_COORDS.lat, OBRADOR_COORDS.lng], {
    radius: 2100,
    color: "#0284c7",
    weight: 2.5,
    dashArray: "6, 6",
    fillColor: "#06b6d4",
    fillOpacity: 0.06,
    interactive: false
  }).addTo(kdsMap);

  const obradorIcon = L.divIcon({
    className: "",
    html: `<div class="gps-marker-pin" style="background:#d9531e; font-size:12px;">🥘 OBRADOR (Malasaña 5)</div>`,
    iconSize: [0, 0]
  });
  obradorMarker = L.marker([OBRADOR_COORDS.lat, OBRADOR_COORDS.lng], {
    icon: obradorIcon,
    zIndexOffset: 1000
  })
    .bindPopup("<strong>🥘 Socarratt Obrador Central</strong><br>Calle Manuela Malasaña, 5 (Madrid)<br>Base de salida y retorno de todas las rondas.")
    .addTo(kdsMap);

  setTimeout(() => {
    if (kdsMap) kdsMap.invalidateSize();
  }, 250);

  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => {
      if (kdsMap) kdsMap.invalidateSize();
    });
    ro.observe(mapEl);
  }

  updateLiveMapMarkers();
}

function changeMapTileStyle(styleKey) {
  if (!kdsMap) return;
  const cfg = MAP_TILE_URLS[styleKey] || MAP_TILE_URLS.google_streets;
  if (currentTileLayer) {
    kdsMap.removeLayer(currentTileLayer);
  }
  currentTileLayer = L.tileLayer(cfg.url, {
    attribution: cfg.attribution,
    maxZoom: 19
  }).addTo(kdsMap);
}

function centerMapOnBase() {
  if (!kdsMap) return;
  kdsMap.invalidateSize();
  kdsMap.flyTo([OBRADOR_COORDS.lat, OBRADOR_COORDS.lng], 14, { duration: 0.6 });
}

function fitAllMapMarkers() {
  if (!kdsMap) return;
  kdsMap.invalidateSize();
  const pts = [[OBRADOR_COORDS.lat, OBRADOR_COORDS.lng]];
  getFilteredOrders().forEach((o) => {
    if (o.lat && o.lng && o.type !== "pickup") pts.push([o.lat, o.lng]);
  });
  kdsState.riders.forEach((r) => {
    if (r.lat && r.lng) pts.push([r.lat, r.lng]);
  });
  if (pts.length > 1) {
    kdsMap.fitBounds(pts, { padding: [45, 45], maxZoom: 15 });
  } else {
    centerMapOnBase();
  }
}

function toggleExpandMap() {
  const grid = document.getElementById("fleet-grid-container");
  const btn = document.getElementById("btn-expand-map");
  kdsState.mapExpanded = !kdsState.mapExpanded;
  if (kdsState.mapExpanded) {
    grid.classList.add("map-expanded");
    btn.textContent = "🗕 Reducir Mapa";
  } else {
    grid.classList.remove("map-expanded");
    btn.textContent = "🔍 Ampliar Mapa";
  }
  setTimeout(() => {
    if (kdsMap) kdsMap.invalidateSize();
  }, 200);
}

function toggleFleetPanel() {
  const panel = document.getElementById("fleet-control-panel");
  const btn = document.getElementById("btn-toggle-gps-panel");
  kdsState.fleetPanelVisible = !kdsState.fleetPanelVisible;
  if (kdsState.fleetPanelVisible) {
    panel.classList.remove("hidden");
    btn.classList.add("active");
    setTimeout(() => {
      if (kdsMap) kdsMap.invalidateSize();
    }, 150);
  } else {
    panel.classList.add("hidden");
    btn.classList.remove("active");
  }
}

function updateLiveMapMarkers() {
  if (!kdsMap) return;

  const activeOrders = getFilteredOrders().filter(
    (o) => o.type !== "pickup" && o.status !== "delivered" && o.lat && o.lng
  );
  const activeOrderIds = new Set(activeOrders.map((o) => o.id));

  Object.keys(destMarkersDict).forEach((ordId) => {
    if (!activeOrderIds.has(ordId)) {
      kdsMap.removeLayer(destMarkersDict[ordId]);
      delete destMarkersDict[ordId];
    }
  });

  activeOrders.forEach((order) => {
    const tel = getOrderTelemetry(order);
    const html = `<div class="dest-marker-pin">📍 ${order.slot}h &bull; ${order.clientName.split(" ")[0]}</div>`;
    const popupHtml =
      `<strong>👤 ${order.clientName}</strong><br>` +
      `📍 ${order.address}<br>` +
      `🔥 Salida Cocina: <strong>${order.slot}h</strong> ➔ Entrega: <strong>${tel.deliveryTargetSlot}h</strong><br>` +
      `📏 ${tel.distanceKm} km (Ida+Subir: ~${tel.outboundBudget}m | Vuelta: ~${tel.returnBudget}m)`;

    if (destMarkersDict[order.id]) {
      destMarkersDict[order.id].setLatLng([order.lat, order.lng]);
      destMarkersDict[order.id].setPopupContent(popupHtml);
    } else {
      const icon = L.divIcon({ className: "", html, iconSize: [0, 0] });
      destMarkersDict[order.id] = L.marker([order.lat, order.lng], { icon })
        .bindPopup(popupHtml)
        .addTo(kdsMap);
    }
  });

  const currentRiderIds = new Set(kdsState.riders.map((r) => r.id));
  Object.keys(riderMarkersDict).forEach((rId) => {
    if (!currentRiderIds.has(rId)) {
      kdsMap.removeLayer(riderMarkersDict[rId]);
      delete riderMarkersDict[rId];
    }
  });
  Object.keys(riderLinesDict).forEach((rId) => {
    if (!currentRiderIds.has(rId)) {
      kdsMap.removeLayer(riderLinesDict[rId]);
      delete riderLinesDict[rId];
    }
  });

  kdsState.riders.forEach((rider, idx) => {
    const currentOrder = kdsState.orders.find(
      (o) => o.riderId === rider.id && (o.status === "en_route" || o.status === "returning")
    );

    let pinBg = "#10b981";
    let statusShort = "En Local";
    let rLat = Number(rider.lat) || OBRADOR_COORDS.lat;
    let rLng = Number(rider.lng) || OBRADOR_COORDS.lng;
    const hasMovedFromBase = Math.abs(rLat - OBRADOR_COORDS.lat) > 0.0006 || Math.abs(rLng - OBRADOR_COORDS.lng) > 0.0006;
    const distFromBaseKm = haversineKm(OBRADOR_COORDS.lat, OBRADOR_COORDS.lng, rLat, rLng);

    const travelTimes = calculateMadridTravelTimes(distFromBaseKm, rider.vehicle);

    let lineCoords = null;
    let isDashed = false;

    if (currentOrder) {
      const tel = getOrderTelemetry(currentOrder);
      if (tel.semaphore === "yellow") pinBg = "#f59e0b";
      if (tel.semaphore === "red") pinBg = "#ef4444";

      // Solo interpolar si el repartidor NO tiene su GPS móvil activo ni se ha movido
      if (!rider.gpsActive && !hasMovedFromBase) {
        const progress = currentOrder.status === "en_route" ? 0.65 : 0.45;
        rLat = OBRADOR_COORDS.lat + (currentOrder.lat - OBRADOR_COORDS.lat) * progress;
        rLng = OBRADOR_COORDS.lng + (currentOrder.lng - OBRADOR_COORDS.lng) * progress;
      }

      if (currentOrder.status === "en_route") {
        statusShort = `➔ ${currentOrder.clientName.split(" ")[0]} (${tel.outboundElapsedMin}/${tel.outboundBudget}m)`;
        lineCoords = [[rLat, rLng], [currentOrder.lat, currentOrder.lng]];
        isDashed = false;
      } else if (currentOrder.status === "returning") {
        statusShort = `🔄 Vuelta (${tel.returnElapsedMin}/${tel.returnBudget}m • GPS ~${travelTimes.activeMin}m)`;
        lineCoords = [[rLat, rLng], [OBRADOR_COORDS.lat, OBRADOR_COORDS.lng]];
        isDashed = true;
      }
    } else if (rider.gpsActive || hasMovedFromBase) {
      // ¡El repartidor ha enviado su ubicación desde su móvil aunque aún no tenga un pedido en fase "en_route"!
      // Mostramos su posición exacta y tiempos reales en coche y bici hacia el Obrador
      pinBg = "#0284c7";
      statusShort = `🛰️ ${distFromBaseKm} km • ${travelTimes.summaryText}`;
      lineCoords = [[rLat, rLng], [OBRADOR_COORDS.lat, OBRADOR_COORDS.lng]];
      isDashed = true;
    } else {
      // Está físicamente en la base de Manuela Malasaña 5
      rLat = OBRADOR_COORDS.lat + (idx - 2) * 0.00045;
      rLng = OBRADOR_COORDS.lng + ((idx % 2) - 0.5) * 0.00065;
    }

    if (lineCoords) {
      if (riderLinesDict[rider.id]) {
        riderLinesDict[rider.id].setLatLngs(lineCoords);
        riderLinesDict[rider.id].setStyle({
          color: pinBg,
          dashArray: isDashed ? "6, 6" : null
        });
      } else {
        riderLinesDict[rider.id] = L.polyline(lineCoords, {
          color: pinBg,
          weight: 4,
          dashArray: isDashed ? "6, 6" : null,
          opacity: 0.9,
          interactive: false
        }).addTo(kdsMap);
      }
    } else if (riderLinesDict[rider.id]) {
      kdsMap.removeLayer(riderLinesDict[rider.id]);
      delete riderLinesDict[rider.id];
    }

    const vEmoji = rider.vehicle === "bike" ? "🚲" : rider.vehicle === "moto" ? "🛵" : "🚗";
    const html = `<div class="gps-marker-pin" style="background:${pinBg};">${vEmoji} ${rider.name.split(" ")[0]} &bull; ${statusShort}</div>`;
    const popupHtml =
      `<strong>${vEmoji} ${rider.name}</strong> ${rider.gpsActive ? '<span style="color:#10b981;font-weight:800;">(🛰️ GPS Móvil en Vivo)</span>' : ''}<br>` +
      `📞 ${rider.phone}<br>` +
      `📏 Distancia al Obrador (Malasaña 5): <strong>${distFromBaseKm} km</strong><br>` +
      `⏱️ Tiempos Maps al local: <strong>🚗 ${travelTimes.carMin} min en coche</strong> &bull; <strong>🚲 ${travelTimes.bikeMin} min en bici</strong><br>` +
      (currentOrder
        ? `📦 Pedido actual: <strong>${currentOrder.clientName}</strong> (${currentOrder.slot}h)<br>` +
          `📍 ${currentOrder.address}<br>` +
          `⏱️ Estado: <strong>${statusShort}</strong>`
        : `✅ <strong>Estado: ${statusShort}</strong>`);

    if (riderMarkersDict[rider.id]) {
      riderMarkersDict[rider.id].setLatLng([rLat, rLng]);
      riderMarkersDict[rider.id].setIcon(L.divIcon({ className: "", html, iconSize: [0, 0] }));
      riderMarkersDict[rider.id].setPopupContent(popupHtml);
    } else {
      riderMarkersDict[rider.id] = L.marker([rLat, rLng], {
        icon: L.divIcon({ className: "", html, iconSize: [0, 0] }),
        zIndexOffset: 600
      })
        .bindPopup(popupHtml)
        .addTo(kdsMap);
    }
  });
}

function toggleGpsSimulation() {
  const btn = document.getElementById("btn-sim-gps");
  kdsState.gpsSimActive = !kdsState.gpsSimActive;

  if (kdsState.gpsSimActive) {
    btn.textContent = "⏸️ Pausar Simulación GPS";
    btn.style.background = "#ef4444";
    btn.style.color = "#fff";

    kdsState.gpsSimInterval = setInterval(() => {
      kdsState.riders.forEach((rider) => {
        if (rider.gpsActive) return; // No pisar a un repartidor que esté usando su móvil real
        const activeOrder = kdsState.orders.find(
          (o) => o.riderId === rider.id && (o.status === "en_route" || o.status === "returning")
        );
        if (!activeOrder) return;
        const targetLat = activeOrder.status === "en_route" ? activeOrder.lat : OBRADOR_COORDS.lat;
        const targetLng = activeOrder.status === "en_route" ? activeOrder.lng : OBRADOR_COORDS.lng;

        const curLat = rider.lat || OBRADOR_COORDS.lat;
        const curLng = rider.lng || OBRADOR_COORDS.lng;
        rider.lat = curLat + (targetLat - curLat) * 0.18 + (Math.random() - 0.5) * 0.0004;
        rider.lng = curLng + (targetLng - curLng) * 0.18 + (Math.random() - 0.5) * 0.0004;
      });
      saveKdsRiders();
      if (!isUserDraggingMap) {
        updateLiveMapMarkers();
      }
    }, 2000);
  } else {
    btn.textContent = "▶️ Simular GPS en Vivo";
    btn.style.background = "";
    btn.style.color = "";
    if (kdsState.gpsSimInterval) clearInterval(kdsState.gpsSimInterval);
  }
}

// ============================================================================
// TARJETAS DE CONTROL DE REPARTIDORES (IDA VS VUELTA + DISTANCIA REAL GPS)
// ============================================================================
function toggleRiderVehicle(riderId) {
  const rider = kdsState.riders.find((r) => r.id === riderId);
  if (!rider) return;
  const cycle = ["bike", "car", "moto"];
  const nextIdx = (cycle.indexOf(rider.vehicle || "bike") + 1) % cycle.length;
  rider.vehicle = cycle[nextIdx];
  saveKdsRiders();
  renderAllKds();
}

function toggleRiderShiftFromPc(riderId) {
  const rider = kdsState.riders.find((r) => r.id === riderId);
  if (!rider) return;
  const currentlyOn = Boolean(rider.onShift || rider.gpsActive);
  rider.onShift = !currentlyOn;
  rider.shiftTimeStr = formatClockTime(Date.now());
  if (!rider.onShift) {
    rider.gpsActive = false;
    rider.forceResetGps = true;
    rider.lat = OBRADOR_COORDS.lat;
    rider.lng = OBRADOR_COORDS.lng;
  }
  saveKdsRiders();
  delete rider.forceResetGps;
  renderAllKds();
}

function renderFleetCards() {
  const container = document.getElementById("kds-riders-list");
  if (!container) return;

  let freeCount = 0;
  let routeCount = 0;
  let onShiftCount = 0;
  let delayAlertsCount = 0;
  const missingShiftNames = [];

  kdsState.riders.forEach((r) => {
    if (r.onShift || r.gpsActive) {
      onShiftCount++;
    } else {
      missingShiftNames.push(r.name);
    }
  });

  const totalRiders = kdsState.riders.length;
  const allOnShift = totalRiders > 0 && onShiftCount === totalRiders;

  const shiftSummaryBanner = `
    <div style="background:${allOnShift ? 'rgba(16, 185, 129, 0.14)' : 'rgba(245, 158, 11, 0.14)'}; border:1px solid ${allOnShift ? '#10b981' : '#f59e0b'}; border-radius:10px; padding:8px 12px; margin-bottom:4px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
      <div style="font-size:0.8rem; font-weight:800; color:${allOnShift ? '#34d399' : '#fcd34d'};">
        ${allOnShift
          ? `✅ TODOS EN TURNO (${onShiftCount}/${totalRiders} repartidores conectados)`
          : `👥 CONTROL DE TURNO: ${onShiftCount} de ${totalRiders} repartidores han iniciado turno`}
      </div>
      <div style="font-size:0.73rem; color:#cbd5e1;">
        ${missingShiftNames.length > 0
          ? `⏳ Sin iniciar: <strong>${missingShiftNames.join(", ")}</strong>`
          : `🛰️ Flota completa operativa`}
      </div>
    </div>
  `;

  const cardsHtml = kdsState.riders.map((rider) => {
    const vEmoji = rider.vehicle === "bike" ? "🚲" : rider.vehicle === "moto" ? "🛵" : "🚗";
    const vLabel = rider.vehicle === "bike" ? "Bici" : rider.vehicle === "moto" ? "Moto" : "Coche";
    const rLat = Number(rider.lat) || OBRADOR_COORDS.lat;
    const rLng = Number(rider.lng) || OBRADOR_COORDS.lng;
    const distFromBaseKm = haversineKm(OBRADOR_COORDS.lat, OBRADOR_COORDS.lng, rLat, rLng);
    const travelTimes = calculateMadridTravelTimes(distFromBaseKm, rider.vehicle);

    const isRiderOnShift = Boolean(rider.onShift || rider.gpsActive);
    const shiftBadgeHtml = isRiderOnShift
      ? `<span style="background:rgba(16,185,129,0.2); color:#34d399; border:1px solid #10b981; padding:2px 7px; border-radius:999px; font-size:0.68rem; font-weight:800; margin-left:6px;">🟢 EN TURNO${rider.shiftTimeStr ? ` (${rider.shiftTimeStr}h)` : ''}</span>`
      : rider.shiftTimeStr
      ? `<span style="background:rgba(239,68,68,0.18); color:#fca5a5; border:1px solid #ef4444; padding:2px 7px; border-radius:999px; font-size:0.68rem; font-weight:800; margin-left:6px;">🔴 CERRÓ TURNO (${rider.shiftTimeStr}h)</span>`
      : `<span style="background:rgba(100,116,139,0.25); color:#94a3b8; border:1px solid #475569; padding:2px 7px; border-radius:999px; font-size:0.68rem; font-weight:800; margin-left:6px;">⚪ SIN INICIAR TURNO</span>`;

    const activeOrder = kdsState.orders.find(
      (o) => o.riderId === rider.id && (o.status === "en_route" || o.status === "returning")
    );

    const upcomingOrders = getFilteredOrders()
      .filter((o) => o.riderId === rider.id && (o.status === "pending" || o.status === "cooking" || o.status === "ready"))
      .sort((a, b) => a.slot.localeCompare(b.slot));

    if (!activeOrder) {
      freeCount++;
      const nextAssigned = upcomingOrders[0];
      const topRightBadge = !isRiderOnShift
        ? `<span class="semaphore-badge" style="background:#334155; color:#cbd5e1;">⚪ FUERA DE TURNO</span>`
        : distFromBaseKm > 0.3
        ? `<span class="semaphore-badge green">🛰️ ${travelTimes.activeMin} MIN (${vEmoji})</span>`
        : `<span class="semaphore-badge green">🟢 EN TURNO (LOCAL)</span>`;

      return `
        <div class="rider-live-card ${isRiderOnShift ? 'sem-green' : ''}" style="${!isRiderOnShift ? 'opacity:0.82; border-left:4px solid #475569;' : ''}">
          <div class="rider-card-top">
            <div class="rider-identity">
              <div class="rider-avatar" onclick="toggleRiderVehicle('${rider.id}')" style="cursor:pointer;" title="Clic para cambiar entre Bici, Coche y Moto">${vEmoji}</div>
              <div>
                <span class="rider-name">${rider.name} ${shiftBadgeHtml}</span>
                <span class="rider-vehicle-tag">
                  ${vLabel} &bull; ${isRiderOnShift && distFromBaseKm > 0.2
                    ? `📍 A <strong>${distFromBaseKm} km</strong> (🚗 <strong>${travelTimes.carMin} min</strong> coche | 🚲 <strong>${travelTimes.bikeMin} min</strong> bici)`
                    : isRiderOnShift
                    ? '📍 En Obrador Malasaña 5 (Listo)'
                    : '📴 Esperando a que pulse "Iniciar Turno" en su móvil'}
                </span>
              </div>
            </div>
            ${topRightBadge}
          </div>

          ${nextAssigned ? `
            <div class="rider-next-round-banner">
              <span>📋 Asignado a ronda <strong>${nextAssigned.slot}h</strong>: ${nextAssigned.clientName}</span>
              <button class="btn-mini btn-mini-orange" onclick="dispatchOrderNow('${nextAssigned.id}')">
                🚀 Dar Salida Ahora
              </button>
            </div>
          ` : `
            <div style="font-size:0.75rem; color:#94a3b8;">
              ${isRiderOnShift
                ? `✅ En turno y disponible. ${distFromBaseKm > 0.2 ? `Llegada al local: <strong>🚗 ${travelTimes.carMin} min coche</strong> / <strong>🚲 ${travelTimes.bikeMin} min bici</strong>` : ''}`
                : `⚠️ Aún no ha iniciado turno desde la App Móvil.`}
            </div>
          `}

          <div class="rider-card-actions">
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              <button class="btn-mini btn-mini-cyan" onclick="focusRiderOnMap('${rider.id}')">📍 Mapa</button>
              <button class="btn-mini" onclick="toggleRiderVehicle('${rider.id}')" title="Cambiar vehículo (Bici / Coche / Moto)">🔄 ${vEmoji} ${vLabel}</button>
              <button class="btn-mini" onclick="toggleRiderShiftFromPc('${rider.id}')" title="Abrir o cerrar turno manualmente desde Cocina">
                ${isRiderOnShift ? '🔴 Cerrar Turno' : '🟢 Abrir Turno'}
              </button>
            </div>
            <div style="display:flex; gap:6px;">
              <button class="btn-mini" onclick="openMobileConnectModal()">📲 QR</button>
              <a href="https://wa.me/${rider.phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(`Hola ${rider.name}, entra en la App de Socarratt y pulsa "🟢 INICIAR TURNO" para activar tu GPS en cocina: ${getActiveMobileBaseUrl()}/repartidor.html?rider=${rider.id}`)}" target="_blank" class="btn-mini">💬 WhatsApp</a>
            </div>
          </div>
        </div>
      `;
    }

    routeCount++;
    const tel = getOrderTelemetry(activeOrder);
    if (tel.semaphore === "red") delayAlertsCount++;

    const nextRoundOrder = upcomingOrders.find((o) => o.slot === tel.nextRoundSlot) || upcomingOrders[0];
    const cleanPhone = rider.phone.replace(/[^0-9]/g, "");
    const waMessage = encodeURIComponent(
      `Hola ${rider.name}, vemos en el panel de Socarratt que saliste con el pedido de las ${activeOrder.slot}h (${activeOrder.clientName}). ¿Por dónde vas? Te necesitamos de vuelta en Manuela Malasaña 5 para la ronda de las ${tel.nextRoundSlot}h.`
    );

    return `
      <div class="rider-live-card sem-${tel.semaphore}">
        <div class="rider-card-top">
          <div class="rider-identity">
            <div class="rider-avatar">${vEmoji}</div>
            <div>
              <span class="rider-name">${rider.name} ${shiftBadgeHtml}</span>
              <span class="rider-vehicle-tag">Ronda ${activeOrder.slot}h ➔ Entrega ${tel.deliveryTargetSlot}h ➔ <strong>Vuelve ${tel.nextRoundSlot}h</strong></span>
            </div>
          </div>
          <span class="semaphore-badge ${tel.semaphore}">${tel.semaphoreLabel}</span>
        </div>

        <div class="rider-trip-box">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong>👤 ${activeOrder.clientName} (${tel.distanceKm} km)</strong>
            <span style="color:#38bdf8; font-weight:800;">📏 Ahora a ${distFromBaseKm} km del local (ETA ~${tel.etaReturnStr}h)</span>
          </div>
          <div style="color:#94a3b8; font-size:0.73rem;">📍 ${activeOrder.address}</div>

          <div class="rider-phases-grid">
            <div class="phase-box ${activeOrder.status === 'en_route' ? 'active-phase' : ''} ${activeOrder.status === 'en_route' && tel.semaphore === 'red' ? 'late-phase' : ''}">
              <span class="phase-label">1️⃣ Ida + Aparcar + Subir</span>
              <div class="phase-timer">
                ${activeOrder.status === "en_route"
                  ? `⏱️ ${tel.outboundElapsedMin} min <small style="color:#94a3b8;font-weight:500;">/ ${tel.outboundBudget}m est.</small>`
                  : `✅ Entregó en ${tel.outboundElapsedMin}m <small style="color:#34d399;">(${formatClockTime(activeOrder.deliveredToClientAt)})</small>`
                }
              </div>
            </div>

            <div class="phase-box ${activeOrder.status === 'returning' ? 'active-phase' : ''} ${activeOrder.status === 'returning' && tel.semaphore === 'red' ? 'late-phase' : ''}">
              <span class="phase-label">2️⃣ Vuelta a Malasaña 5</span>
              <div class="phase-timer">
                ${activeOrder.status === "returning"
                  ? `⏱️ ${tel.returnElapsedMin} min <small style="color:#94a3b8;font-weight:500;">/ ${tel.returnBudget}m est.</small>`
                  : `<span style="color:#64748b; font-size:0.75rem;">Esperando check entrega (${tel.returnBudget}m est.)</span>`
                }
              </div>
            </div>
          </div>

          ${activeOrder.deliveryProof ? `
            <div class="proof-badge">
              📸 <strong>Check de Entrega:</strong> ${activeOrder.deliveryProof} (a las ${formatClockTime(activeOrder.deliveredToClientAt)}h)
            </div>
          ` : ""}

          ${tel.alertReason ? `
            <div style="background:rgba(239,68,68,0.2); border:1px solid #ef4444; color:#fecaca; padding:5px 8px; border-radius:6px; font-size:0.73rem; font-weight:700;">
              🚨 ${tel.alertReason}
            </div>
          ` : ""}
        </div>

        <div class="rider-next-round-banner">
          <span>
            🔄 <strong>Ronda +1h (${tel.nextRoundSlot}h):</strong>
            ${nextRoundOrder
              ? `Ya reservado para <strong>${nextRoundOrder.clientName}</strong> (${nextRoundOrder.slot}h)`
              : `Quedará libre en el local para las <strong>${tel.nextRoundSlot}h</strong>`}
          </span>
        </div>

        <div class="rider-card-actions">
          <div style="display:flex; gap:5px; flex-wrap:wrap;">
            <button class="btn-mini btn-mini-cyan" onclick="focusRiderOnMap('${rider.id}')" title="Centrar mapa en este repartidor">📍 Ver en Mapa</button>
            ${activeOrder.status === "en_route" ? `
              <button class="btn-mini btn-mini-orange" onclick="markOrderDeliveredByClient('${activeOrder.id}', 'Confirmado desde Cocina')">
                ✅ Marcar Entregado
              </button>
            ` : `
              <button class="btn-mini btn-mini-green" onclick="markRiderReturnedToBase('${activeOrder.id}')">
                🏁 Ya Llegó al Local
              </button>
            `}
          </div>

          <div style="display:flex; gap:5px;">
            <a href="https://wa.me/${cleanPhone}?text=${waMessage}" target="_blank" class="btn-mini" style="border-color:#ef4444; color:#fca5a5;">
              📢 Reclamar
            </a>
          </div>
        </div>
      </div>
    `;
  }).join("");

  container.innerHTML = shiftSummaryBanner + cardsHtml;

  const fleetKpi = document.getElementById("kpi-fleet-status");
  if (fleetKpi) fleetKpi.textContent = `${onShiftCount}/${totalRiders} En Turno (${routeCount} Ruta)`;

  const fleetSub = document.getElementById("kpi-fleet-sub");
  if (fleetSub) {
    fleetSub.textContent = allOnShift
      ? "✅ Todos los repartidores han iniciado turno"
      : `⏳ Faltan ${totalRiders - onShiftCount} por iniciar turno`;
  }

  const delayKpi = document.getElementById("kpi-delays-count");
  const delaySub = document.getElementById("kpi-delays-sub");
  if (delayKpi) {
    delayKpi.textContent = delayAlertsCount === 0 ? "0 retrasos" : `🚨 ${delayAlertsCount} en retraso`;
    delayKpi.style.color = delayAlertsCount > 0 ? "#ef4444" : "#10b981";
  }
  if (delaySub) {
    delaySub.textContent = delayAlertsCount > 0
      ? "¡Atención! Repartidor excediendo tiempo de vuelta"
      : "Todos los repartidores dentro del tiempo estimado";
  }
}

function estReturnMinMin(v) {
  return Math.max(1, v);
}

function focusRiderOnMap(riderId) {
  if (!kdsMap) return;
  const marker = riderMarkersDict[riderId];
  if (marker) {
    kdsMap.invalidateSize();
    kdsMap.flyTo(marker.getLatLng(), 15, { duration: 0.5 });
    marker.openPopup();
  }
}

// ============================================================================
// TABLÓN HORIZONTAL POR FRANJAS DE 30 MIN (CON TARJETAS PLEGABLES/DESPLEGABLES)
// ============================================================================
function renderKdsBoard() {
  const container = document.getElementById("kds-slots-grid");
  if (!container) return;

  const orders = getFilteredOrders();

  let totalPaellasGrandes = 0;
  let totalRaciones = 0;

  orders.forEach((o) => {
    if (o.status !== "delivered") {
      o.items.forEach((item) => {
        if (item.format.includes("grande")) totalPaellasGrandes++;
        else totalRaciones += parseInt(item.format) || 2;
      });
    }
  });

  document.getElementById("kpi-paellas-count").textContent = totalPaellasGrandes;
  document.getElementById("kpi-raciones-count").textContent = totalRaciones;

  container.innerHTML = KITCHEN_SLOTS.map((slot) => {
    const slotOrders = orders.filter((o) => o.slot === slot);
    const deliveryClientSlot = addMinutesToSlot(slot, 30);
    const returnNextSlot = addMinutesToSlot(slot, 60);
    const prevHourSlot = addMinutesToSlot(slot, -60);

    const returningOrdersForThisSlot = orders.filter(
      (o) => o.slot === prevHourSlot && o.riderId && o.status !== "delivered"
    );

    const returningPillsHtml = returningOrdersForThisSlot.map((ro) => {
      const r = kdsState.riders.find((x) => x.id === ro.riderId);
      if (!r) return "";
      const tel = getOrderTelemetry(ro);
      const pillClass = tel.semaphore === "red" ? "returning-late" : "returning-ok";
      return `
        <span class="forecast-pill ${pillClass}" title="Salió en la ronda de las ${prevHourSlot}h con el pedido de ${ro.clientName}">
          ${tel.semaphore === "red" ? "🚨" : "🔄"} ${r.name.split(" ")[0]} (de ${prevHourSlot}h ➔ llega ~${tel.etaReturnStr}h)
        </span>
      `;
    }).join("");

    return `
      <div class="slot-column" data-slot="${slot}">
        <div class="slot-header">
          <div class="slot-header-top">
            <div class="slot-time">
              <span>🔥 Sale Cocina: ${slot}h</span>
            </div>
            <span class="slot-badge">${slotOrders.length} ${slotOrders.length === 1 ? 'pedido' : 'pedidos'}</span>
          </div>

          <div class="slot-cycle-explain">
            <span>🛵 Entrega: <strong>~${deliveryClientSlot}h</strong></span>
            <span>🔄 Repartidor vuelve: <strong>${returnNextSlot}h</strong></span>
          </div>
        </div>

        ${returningOrdersForThisSlot.length > 0 ? `
          <div class="slot-riders-forecast">
            <div class="forecast-title">
              <span>🔄 Regresan de la ronda de las ${prevHourSlot}h para salir a las ${slot}h:</span>
            </div>
            <div class="forecast-pills">
              ${returningPillsHtml}
            </div>
          </div>
        ` : ""}

        <div class="slot-orders-list">
          ${slotOrders.length === 0 ? `
            <div class="slot-empty">Sin salidas de cocina a las ${slot}h</div>
          ` : slotOrders.map(renderTicketCard).join("")}
        </div>
      </div>
    `;
  }).join("");
}

// Renderizar tarjeta individual con Modo Plegado Compacto (Paella + Calle + Precio) y Desplegado Completo
function renderTicketCard(order) {
  const tel = getOrderTelemetry(order);
  const prev30Slot = addMinutesToSlot(order.slot, -30);
  const prev60Slot = addMinutesToSlot(order.slot, -60);
  const orderIsoDate = normalizeOrderDate(order.date);
  const isCollapsed = collapsedTicketsSet.has(order.id);

  // Resumen compacto de platos (ej: "🥘 Paella grande (8p) - Valenciana")
  const mainPaellaSummary = order.items
    .map((i) => `${i.highlight || i.format}: ${i.name}`)
    .join(" + ");

  const vIconCompact = order.type === "pickup" ? "🏢" : order.vehicle === "bike" ? "🚲" : "🚗";
  const assignedRiderObj = kdsState.riders.find((r) => r.id === order.riderId);
  const riderShortName = assignedRiderObj
    ? `🛵 ${assignedRiderObj.name.split(" ")[0]}`
    : order.type === "pickup"
      ? "🏢 Recoge en local"
      : "⚠️ Sin repartidor";

  let vehicleBadge = "";
  let timingAlert = "";

  if (order.type === "pickup" || order.vehicle === "pickup") {
    vehicleBadge = `<span class="logistics-pill pill-pickup">🏢 Recogida en Obrador</span>`;
    timingAlert = `<div class="ticket-timing-alert">📍 El cliente recoge en C/ Manuela Malasaña, 5 a las ${order.slot}h</div>`;
  } else {
    const isBike = order.vehicle === "bike";
    vehicleBadge = isBike
      ? `<span class="logistics-pill pill-bike">🚲 Bici Carga (${tel.distanceKm} km)</span>`
      : `<span class="logistics-pill pill-car">🚗 Coche (${tel.distanceKm} km)</span>`;

    timingAlert = `
      <div class="ticket-timing-alert ${isBike ? 'timing-bike' : 'timing-car'}">
        🔥 <strong>Sale ${order.slot}h</strong> ➔ Entrega <strong>~${tel.deliveryTargetSlot}h</strong> (${tel.outboundBudget}m ida+subir)<br>
        🔄 Vuelta estimada: <strong>${tel.returnBudget} min</strong> ➔ Listo en local para ronda <strong>${tel.nextRoundSlot}h</strong>
      </div>
    `;
  }

  let riderControlHtml = "";
  if (order.type !== "pickup" && order.vehicle !== "pickup") {
    const sameDayOrders = kdsState.orders.filter((o) => normalizeOrderDate(o.date) === orderIsoDate);
    const optionsHtml = kdsState.riders.map((r) => {
      const vEmoji = r.vehicle === "bike" ? "🚲" : r.vehicle === "moto" ? "🛵" : "🚗";
      const busyInPrev30 = sameDayOrders.find(
        (o) => o.id !== order.id && o.riderId === r.id && o.slot === prev30Slot && o.status !== "delivered"
      );
      const busyInSameSlot = sameDayOrders.find(
        (o) => o.id !== order.id && o.riderId === r.id && o.slot === order.slot && o.status !== "delivered"
      );
      const returningFromPrev60 = sameDayOrders.find(
        (o) => o.id !== order.id && o.riderId === r.id && o.slot === prev60Slot && o.status !== "delivered"
      );

      let availabilityTag = "🟢 Disponible";
      if (busyInSameSlot) {
        availabilityTag = `⚠️ Ya lleva otro de las ${order.slot}h`;
      } else if (busyInPrev30) {
        availabilityTag = `⛔ Ocupado (Salió ${prev30Slot}h -> no vuelve hasta ${addMinutesToSlot(prev30Slot, 60)}h)`;
      } else if (returningFromPrev60) {
        const prevTel = getOrderTelemetry(returningFromPrev60);
        availabilityTag = prevTel.semaphore === "red"
          ? `🚨 Volviendo de ${prev60Slot}h con RETRASO (~${prevTel.etaReturnStr}h)`
          : `🔄 Vuelve de ronda ${prev60Slot}h (llega ~${prevTel.etaReturnStr}h)`;
      }

      return `<option value="${r.id}" ${order.riderId === r.id ? "selected" : ""}>${vEmoji} ${r.name} — ${availabilityTag}</option>`;
    }).join("");

    riderControlHtml = `
      <div class="ticket-rider-box">
        <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.73rem; font-weight:800; color:#cbd5e1;">
          <span>🛵 Repartidor asignado:</span>
          ${order.status === "en_route" || order.status === "returning"
            ? `<span class="semaphore-badge ${tel.semaphore}" style="font-size:0.66rem; padding:2px 6px;">${tel.semaphoreLabel}</span>`
            : ""}
        </div>

        <select class="ticket-rider-select" onchange="assignRiderToOrder('${order.id}', this.value)">
          <option value="">-- Sin asignar repartidor --</option>
          ${optionsHtml}
        </select>

        ${(order.status === "en_route" || order.status === "returning") ? `
          <div class="ticket-live-telemetry">
            <div class="telemetry-row">
              <span>1️⃣ Ida + Subir al piso:</span>
              <strong>${order.status === "en_route" ? `⏱️ ${tel.outboundElapsedMin}m / ${tel.outboundBudget}m` : `✅ ${tel.outboundElapsedMin}m (${formatClockTime(order.deliveredToClientAt)}h)`}</strong>
            </div>
            <div class="telemetry-row">
              <span>2️⃣ Vuelta a Malasaña 5:</span>
              <strong style="color:${order.status === 'returning' && tel.semaphore === 'red' ? '#f87171' : '#38bdf8'};">
                ${order.status === "returning" ? `⏱️ ${tel.returnElapsedMin}m / ${tel.returnBudget}m (ETA ~${tel.etaReturnStr}h)` : `⏳ Pendiente entregar (${tel.returnBudget}m est.)`}
              </strong>
            </div>
            ${order.deliveryProof ? `
              <div class="proof-badge">📸 ${order.deliveryProof}</div>
            ` : ""}
          </div>
        ` : ""}
      </div>
    `;
  }

  const statusLabels = {
    pending: { label: "⏳ Pendiente", class: "status-pending" },
    cooking: { label: "🔥 Al Fuego", class: "status-cooking" },
    ready: { label: "🚀 Dar Salida", class: "status-ready" },
    en_route: { label: "📸 Entregado", class: "status-enroute" },
    returning: { label: "🏁 En Local", class: "status-returning" },
    delivered: { label: "✅ Completado", class: "status-delivered" }
  };
  const currentSt = statusLabels[order.status] || statusLabels.pending;

  return `
    <div class="ticket-card ${tel.semaphore === 'red' ? 'ticket-delayed' : ''} ${isCollapsed ? 'collapsed' : ''}" id="ticket-${order.id}">
      
      <!-- RESUMEN COMPACTO SIEMPRE VISIBLE (PAELLA + PRECIO + CALLE + ESTADO) -->
      <div class="ticket-compact-summary" onclick="toggleTicketCollapse('${order.id}', event)">
        <div class="compact-row-main">
          <div class="compact-paella-title">${mainPaellaSummary}</div>
          <div class="compact-price-tag">${order.total ? order.total.toFixed(2) + ' €' : ''}</div>
        </div>

        <div class="compact-street-row">
          <span>${vIconCompact}</span>
          <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">📍 ${order.address}</span>
          ${tel.distanceKm > 0 ? `<small style="color:#94a3b8; font-weight:700;">${tel.distanceKm}km</small>` : ''}
        </div>

        <div class="compact-bottom-bar" onclick="event.stopPropagation()">
          <div style="display:flex; align-items:center; gap:6px; font-size:0.74rem; color:#cbd5e1; font-weight:700;">
            <span>${riderShortName}</span>
            ${(order.status === "en_route" || order.status === "returning") ? `
              <span class="semaphore-badge ${tel.semaphore}" style="font-size:0.64rem; padding:1px 6px;">
                ${order.status === "en_route" ? `Ida ${tel.outboundElapsedMin}m` : `Vuelta ${tel.returnElapsedMin}m`}
              </span>
            ` : ""}
          </div>

          <div style="display:flex; align-items:center; gap:5px;">
            <button class="ticket-status-btn ${currentSt.class}" style="padding:4px 8px; font-size:0.72rem;" onclick="cycleOrderStatus('${order.id}')" title="Avanzar estado del pedido">
              ${currentSt.label}
            </button>
            <button type="button" class="btn-collapse-toggle" onclick="toggleTicketCollapse('${order.id}', event)" title="Desplegar o plegar detalles del pedido">
              ${isCollapsed ? "▼ Más" : "▲ Plegar"}
            </button>
          </div>
        </div>
      </div>

      <!-- DETALLES DESPLEGABLES COMPLETOS -->
      <div class="ticket-details-collapsible">
        <div class="ticket-header">
          <div>
            <span class="ticket-client">👤 ${order.clientName}</span>
            <span class="ticket-phone">📞 ${order.clientPhone}</span>
          </div>

          <div class="ticket-top-tools">
            <span class="ticket-date-pill" title="Fecha de reserva: ${orderIsoDate}">📅 ${formatShortDateBadge(orderIsoDate)}</span>
            <button type="button" class="btn-ticket-tool" onclick="openEditOrderModal('${order.id}')" title="Editar hora, fecha o datos del pedido">✏️</button>
            <button type="button" class="btn-ticket-tool delete" onclick="deleteOrderFromBoard('${order.id}')" title="Eliminar este pedido del tablón">🗑️</button>
          </div>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; flex-wrap:wrap;">
          ${vehicleBadge}
          ${order.departedAt ? `<span style="font-size:0.7rem; color:#94a3b8;">Salió: ${formatClockTime(order.departedAt)}h</span>` : ""}
        </div>

        ${timingAlert}

        ${riderControlHtml}

        <div class="ticket-items">
          ${order.items.map(i => `
            <div class="ticket-item-row">
              • <strong class="ticket-item-highlight">${i.highlight || i.name}</strong>: ${i.name}
              ${i.option ? `<br>&nbsp;&nbsp;<em style="color:#94a3b8;">└ Punto: ${i.option}</em>` : ''}
              ${i.notes ? `<br>&nbsp;&nbsp;<em style="color:#fbbf24;">└ Nota: ${i.notes}</em>` : ''}
            </div>
          `).join("")}
        </div>
      </div>
    </div>
  `;
}

// ============================================================================
// ELIMINAR Y EDITAR PEDIDOS DEL TABLERO
// ============================================================================
function deleteOrderFromBoard(orderId) {
  const order = kdsState.orders.find((o) => o.id === orderId);
  if (!order) return;

  const ok = confirm(`🗑️ ¿Seguro que quieres eliminar el pedido de "${order.clientName}" (${order.slot}h)?`);
  if (!ok) return;

  kdsState.orders = kdsState.orders.filter((o) => o.id !== orderId);
  saveKdsOrders();
  renderAllKds();
}

function clearDeliveredOrders() {
  const deliveredCount = kdsState.orders.filter((o) => o.status === "delivered").length;
  if (deliveredCount === 0) {
    alert("No hay pedidos marcados como 'Completados/Entregados' para limpiar.");
    return;
  }
  const ok = confirm(`🧹 ¿Quieres borrar del tablón los ${deliveredCount} pedidos que ya están terminados y entregados?`);
  if (!ok) return;

  kdsState.orders = kdsState.orders.filter((o) => o.status !== "delivered");
  saveKdsOrders();
  renderAllKds();
}

function openEditOrderModal(orderId) {
  const order = kdsState.orders.find((o) => o.id === orderId);
  if (!order) return;

  document.getElementById("manual-modal-title").textContent = `✏️ Editar Pedido de ${order.clientName}`;
  document.getElementById("m-edit-order-id").value = order.id;
  document.getElementById("m-client-name").value = order.clientName.replace(" (Llamada)", "");
  document.getElementById("m-client-phone").value = order.clientPhone;
  document.getElementById("m-order-date").value = normalizeOrderDate(order.date);
  document.getElementById("m-slot").value = order.slot;
  document.getElementById("m-type").value = order.type || "delivery_whole";
  document.getElementById("m-address-group").style.display = order.type === "pickup" ? "none" : "block";
  document.getElementById("m-address").value = order.type === "pickup" ? "" : order.address;

  const firstItem = order.items && order.items[0] ? order.items[0] : {};
  if (firstItem.name) document.getElementById("m-rice").value = firstItem.name;
  if (firstItem.format) document.getElementById("m-format").value = firstItem.format;
  if (firstItem.option) document.getElementById("m-option").value = firstItem.option;
  document.getElementById("m-notes").value = firstItem.notes || "";
  document.getElementById("m-total").value = order.total || 115;

  document.getElementById("manual-order-modal").classList.add("active");
}

// ============================================================================
// ACCIONES DE ASIGNACIÓN, SALIDA, CHECK DE ENTREGA Y REGRESO AL LOCAL
// ============================================================================
function assignRiderToOrder(orderId, riderId) {
  const order = kdsState.orders.find((o) => o.id === orderId);
  if (!order) return;

  const orderIsoDate = normalizeOrderDate(order.date);

  if (riderId) {
    const prev30Slot = addMinutesToSlot(order.slot, -30);
    const conflictOrder = kdsState.orders.find(
      (o) =>
        o.id !== orderId &&
        normalizeOrderDate(o.date) === orderIsoDate &&
        o.riderId === riderId &&
        o.slot === prev30Slot &&
        o.status !== "delivered"
    );
    if (conflictOrder) {
      const r = kdsState.riders.find((x) => x.id === riderId);
      const confirmOverlap = confirm(
        `⚠️ ATENCIÓN: ${r ? r.name : "Este repartidor"} tiene asignado un pedido que sale a las ${prev30Slot}h (${conflictOrder.clientName}).\n\n` +
        `Como entre envolver, ir, aparcar y subir tarda ~30 min, a las ${order.slot}h estará entregando al cliente y no habrá vuelto al local hasta las ${addMinutesToSlot(prev30Slot, 60)}h.\n\n` +
        `¿Seguro que quieres asignarle también esta salida de las ${order.slot}h (por ejemplo, si lleva los dos pedidos juntos en el mismo viaje)?`
      );
      if (!confirmOverlap) {
        renderAllKds();
        return;
      }
    }
  }

  order.riderId = riderId;
  if (riderId) {
    const r = kdsState.riders.find((x) => x.id === riderId);
    if (r) order.vehicle = r.vehicle === "car" ? "car" : "bike";
  }

  saveKdsOrders();
  renderAllKds();
}

function dispatchOrderNow(orderId) {
  const order = kdsState.orders.find((o) => o.id === orderId);
  if (!order) return;

  if (order.type !== "pickup" && !order.riderId) {
    alert("⚠️ Selecciona primero qué repartidor se lleva esta paella para activar su cronómetro de ida y vuelta.");
    return;
  }

  order.status = "en_route";
  order.departedAt = Date.now();
  order.deliveredToClientAt = null;
  order.returnedToStoreAt = null;

  const rider = kdsState.riders.find((r) => r.id === order.riderId);
  if (rider && !rider.gpsActive) {
    rider.lat = OBRADOR_COORDS.lat + (order.lat - OBRADOR_COORDS.lat) * 0.15;
    rider.lng = OBRADOR_COORDS.lng + (order.lng - OBRADOR_COORDS.lng) * 0.15;
    saveKdsRiders();
  }

  saveKdsOrders();
  renderAllKds();
}

function markOrderDeliveredByClient(orderId, defaultProof = "") {
  const order = kdsState.orders.find((o) => o.id === orderId);
  if (!order) return;

  const proof = defaultProof || prompt(
    `📸 Confirmación de Entrega a ${order.clientName} (${order.address}):\nIndica a quién se entregó o nota rápida (ej: "Entregado en mano", "Portero"):`,
    "Entregado en mano al cliente"
  );
  if (proof === null) return;

  order.status = "returning";
  if (!order.departedAt) order.departedAt = Date.now() - (order.outboundMinutes || 25) * 60000;
  order.deliveredToClientAt = Date.now();
  order.deliveryProof = proof.trim() || "Entregado al cliente";

  const rider = kdsState.riders.find((r) => r.id === order.riderId);
  if (rider && !rider.gpsActive && order.lat && order.lng) {
    rider.lat = order.lat;
    rider.lng = order.lng;
    saveKdsRiders();
  }

  saveKdsOrders();
  renderAllKds();
}

function markRiderReturnedToBase(orderId) {
  const order = kdsState.orders.find((o) => o.id === orderId);
  if (!order) return;

  order.status = "delivered";
  order.returnedToStoreAt = Date.now();

  const rider = kdsState.riders.find((r) => r.id === order.riderId);
  if (rider) {
    rider.lat = OBRADOR_COORDS.lat;
    rider.lng = OBRADOR_COORDS.lng;
    rider.gpsActive = false;
    rider.forceResetGps = true;
    saveKdsRiders();
    delete rider.forceResetGps;
  }

  saveKdsOrders();
  renderAllKds();
}

function cycleOrderStatus(orderId) {
  const order = kdsState.orders.find((o) => o.id === orderId);
  if (!order) return;

  if (order.type === "pickup" || order.vehicle === "pickup") {
    const pickupCycle = ["pending", "cooking", "ready", "delivered"];
    const nextIdx = (pickupCycle.indexOf(order.status) + 1) % pickupCycle.length;
    order.status = pickupCycle[nextIdx];
    saveKdsOrders();
    renderAllKds();
    return;
  }

  if (order.status === "pending") {
    order.status = "cooking";
  } else if (order.status === "cooking") {
    order.status = "ready";
  } else if (order.status === "ready") {
    dispatchOrderNow(order.id);
    return;
  } else if (order.status === "en_route") {
    markOrderDeliveredByClient(order.id);
    return;
  } else if (order.status === "returning") {
    markRiderReturnedToBase(order.id);
    return;
  } else {
    order.status = "pending";
    order.departedAt = null;
    order.deliveredToClientAt = null;
    order.returnedToStoreAt = null;
  }

  saveKdsOrders();
  renderAllKds();
}

// ============================================================================
// GESTIÓN DE LA PLANTILLA DE REPARTIDORES (MODAL)
// ============================================================================
function openRidersModal() {
  const modal = document.getElementById("riders-manage-modal");
  renderRidersModalList();
  modal.classList.add("active");
}

function closeRidersModal() {
  document.getElementById("riders-manage-modal").classList.remove("active");
}

function renderRidersModalList() {
  const listEl = document.getElementById("riders-modal-list");
  if (!listEl) return;

  listEl.innerHTML = kdsState.riders.map((r) => {
    const vEmoji = r.vehicle === "bike" ? "🚲 Bici de Carga" : r.vehicle === "moto" ? "🛵 Moto" : "🚗 Coche";
    const mobileLink = `${PUBLIC_TUNNEL_BASE}/repartidor.html?rider=${r.id}`;
    const waLink = `https://wa.me/${r.phone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(
      `Hola ${r.name}, entra aquí desde tu móvil para abrir tu pantalla de repartidor de Socarratt con GPS y botón de entregado:\n👉 ${mobileLink}`
    )}`;

    return `
      <div style="display:flex; justify-content:space-between; align-items:center; background:#0f172a; padding:8px 12px; border-radius:8px; border:1px solid #334155;">
        <div>
          <strong style="font-size:0.88rem;">${r.name}</strong>
          <span style="font-size:0.75rem; color:#94a3b8; margin-left:8px;">${vEmoji} &bull; 📞 ${r.phone}</span>
        </div>
        <div style="display:flex; gap:6px;">
          <a href="${waLink}" target="_blank" class="btn-mini btn-mini-green">📲 Mandar a su WhatsApp</a>
          <button class="btn-mini btn-mini-danger" onclick="deleteRider('${r.id}')">Eliminar</button>
        </div>
      </div>
    `;
  }).join("");
}

function addNewRider() {
  const name = document.getElementById("new-rider-name").value.trim();
  const vehicle = document.getElementById("new-rider-vehicle").value;
  const phone = document.getElementById("new-rider-phone").value.trim();
  if (!name || !phone) return;

  kdsState.riders.push({
    id: `rider-${Date.now()}`,
    name,
    vehicle,
    phone,
    lat: OBRADOR_COORDS.lat,
    lng: OBRADOR_COORDS.lng,
    gpsActive: false
  });

  document.getElementById("new-rider-name").value = "";
  document.getElementById("new-rider-phone").value = "";
  saveKdsRiders();
  renderRidersModalList();
  renderAllKds();
}

function deleteRider(riderId) {
  kdsState.riders = kdsState.riders.filter((r) => r.id !== riderId);
  saveKdsRiders();
  renderRidersModalList();
  renderAllKds();
}

// ============================================================================
// LISTENERS, SINCRONIZACIÓN EN TIEMPO REAL Y MODAL DE PEDIDO TELEFÓNICO
// ============================================================================
function setupKdsListeners() {
  const btnNewManual = document.getElementById("btn-new-phone-order");
  if (btnNewManual) {
    btnNewManual.addEventListener("click", openManualOrderModal);
  }

  const btnPrint = document.getElementById("btn-print-kds");
  if (btnPrint) {
    btnPrint.addEventListener("click", () => window.print());
  }

  window.addEventListener("storage", (e) => {
    if (e.key === "socarratt_orders" || e.key === "socarratt_riders") {
      loadKdsData();
      renderAllKds();
    }
  });

  if (liveChannel) {
    liveChannel.onmessage = (ev) => {
      if (ev.data && ev.data.type === "RIDER_PATCH") {
        applyMobileRiderPatch(ev.data.payload);
      } else {
        loadKdsData();
        renderAllKds();
      }
    };
  }
}

function openManualOrderModal() {
  document.getElementById("manual-modal-title").textContent = "➕ Nueva Comanda / Reserva por Teléfono";
  document.getElementById("m-edit-order-id").value = "";
  document.getElementById("m-client-name").value = "";
  document.getElementById("m-client-phone").value = "";
  document.getElementById("m-address").value = "";
  document.getElementById("m-notes").value = "";

  const defaultDate = kdsState.selectedFilterDate === "all" ? getIsoDateOffset(0) : kdsState.selectedFilterDate;
  document.getElementById("m-order-date").value = defaultDate;

  document.getElementById("manual-order-modal").classList.add("active");
}

function closeManualModal() {
  document.getElementById("manual-order-modal").classList.remove("active");
}

function saveManualPhoneOrder() {
  const editId = document.getElementById("m-edit-order-id").value;
  const name = document.getElementById("m-client-name").value.trim();
  const phone = document.getElementById("m-client-phone").value.trim();
  const orderDate = document.getElementById("m-order-date").value || getIsoDateOffset(0);
  const slot = document.getElementById("m-slot").value;
  const type = document.getElementById("m-type").value;
  const address = document.getElementById("m-address").value.trim() || "Recoge en Obrador (Manuela Malasaña 5)";
  const rice = document.getElementById("m-rice").value;
  const format = document.getElementById("m-format").value;
  const option = document.getElementById("m-option").value;
  const notes = document.getElementById("m-notes").value.trim();
  const total = parseFloat(document.getElementById("m-total").value) || 0;

  if (!name || !phone) {
    alert("Por favor, introduce al menos el nombre y teléfono del cliente.");
    return;
  }

  const isPickup = type === "pickup";
  const routeEst = estimateMadridRoute(address, isPickup);

  if (editId) {
    const existing = kdsState.orders.find((o) => o.id === editId);
    if (existing) {
      existing.clientName = name;
      existing.clientPhone = phone;
      existing.date = orderDate;
      existing.slot = slot;
      existing.type = type;
      existing.vehicle = isPickup ? "pickup" : (existing.riderId ? existing.vehicle : routeEst.vehicle);
      existing.address = isPickup ? "Recoge en Obrador (Manuela Malasaña 5)" : address;
      existing.lat = routeEst.lat;
      existing.lng = routeEst.lng;
      existing.distanceKm = routeEst.distanceKm;
      existing.outboundMinutes = routeEst.outboundMinutes;
      existing.returnMinutes = routeEst.returnMinutes;
      existing.items = [
        {
          name: rice,
          format: format,
          highlight: format.includes("grande") ? `🥘 ${format}` : `🍽️ ${format}`,
          option: option,
          notes: notes
        }
      ];
      existing.total = total;
    }
  } else {
    const newOrder = {
      id: `ord-tel-${Date.now()}`,
      clientName: name,
      clientPhone: phone,
      slot: slot,
      date: orderDate,
      type: type,
      vehicle: routeEst.vehicle,
      riderId: "",
      address: isPickup ? "Recoge en Obrador (Manuela Malasaña 5)" : address,
      lat: routeEst.lat,
      lng: routeEst.lng,
      distanceKm: routeEst.distanceKm,
      outboundMinutes: routeEst.outboundMinutes,
      returnMinutes: routeEst.returnMinutes,
      items: [
        {
          name: rice,
          format: format,
          highlight: format.includes("grande") ? `🥘 ${format}` : `🍽️ ${format}`,
          option: option,
          notes: notes
        }
      ],
      total: total,
      status: "pending"
    };
    kdsState.orders.unshift(newOrder);
  }

  kdsState.selectedFilterDate = orderDate;

  saveKdsOrders();
  renderAllKds();
  closeManualModal();
}

// ============================================================================
// MODAL DE CONEXIÓN MÓVIL (CÓDIGO QR + ENLACE HTTPS + ENVIAR POR WHATSAPP)
// ============================================================================
function setMobileQrMode(mode) {
  mobileQrMode = mode;
  const btnTunnel = document.getElementById("qr-mode-tunnel");
  const btnWifi = document.getElementById("qr-mode-wifi");
  if (btnTunnel) btnTunnel.classList.toggle("active", mode === "tunnel");
  if (btnWifi) btnWifi.classList.toggle("active", mode === "wifi");
  updateMobileQrAndLinks();
}

function refreshLiveTunnelScript(callback) {
  const oldScript = document.getElementById("dynamic-tunnel-script");
  if (oldScript) oldScript.remove();
  const s = document.createElement("script");
  s.id = "dynamic-tunnel-script";
  s.src = "tunnel.js?t=" + Date.now();
  s.onload = () => {
    if (callback) callback();
  };
  s.onerror = () => {
    if (callback) callback();
  };
  document.body.appendChild(s);
}

function openMobileConnectModal() {
  const modal = document.getElementById("mobile-connect-modal");
  if (!modal) return;
  updateMobileQrAndLinks();
  modal.classList.add("active");
  // Recargar tunnel.js en vivo por si el túnel ha renovado su subdominio
  refreshLiveTunnelScript(() => {
    updateMobileQrAndLinks();
  });
}

function closeMobileConnectModal() {
  const modal = document.getElementById("mobile-connect-modal");
  if (modal) modal.classList.remove("active");
}

function updateMobileQrAndLinks() {
  const targetSelect = document.getElementById("mobile-link-target");
  const path = targetSelect ? targetSelect.value : "/repartidor.html";
  const baseUrl = getActiveMobileBaseUrl();
  const fullUrl = `${baseUrl}${path}`;

  const inputEl = document.getElementById("mobile-public-url-input");
  if (inputEl) inputEl.value = fullUrl;

  const qrImg = document.getElementById("mobile-qr-img");
  if (qrImg) {
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=${encodeURIComponent(fullUrl)}`;
  }

  const waBtn = document.getElementById("btn-send-wa-mobile");
  if (waBtn) {
    const label =
      path === "/repartidor.html"
        ? "🛵 App Móvil de Repartidor (GPS + Entregado)"
        : path === "/cocina.html"
        ? "🥘 Tablón de Cocina y Radar GPS"
        : "🛒 Carta Web de Clientes";
    const msg = `🥘 *Socarratt Valencian Food* — Enlace directo para abrir en el móvil (${label}):\n👉 ${fullUrl}`;
    waBtn.href = `https://wa.me/?text=${encodeURIComponent(msg)}`;
  }
}

function copyMobileUrl() {
  const inputEl = document.getElementById("mobile-public-url-input");
  if (!inputEl) return;
  inputEl.select();
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(inputEl.value).then(() => {
      alert("✅ Enlace copiado al portapapeles:\n" + inputEl.value);
    });
  } else {
    document.execCommand("copy");
    alert("✅ Enlace copiado:\n" + inputEl.value);
  }
}

