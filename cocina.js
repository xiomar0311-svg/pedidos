/**
 * LÓGICA DEL PANEL DE COCINA, EXPEDICIÓN, RADAR GPS Y CIERRE DE CAJA - SOCARRATT
 * Obrador Central: Calle Manuela Malasaña, 5 (Madrid) -> Coordenadas: [40.4288, -3.7042]
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

const KITCHEN_SLOTS = ["13:00", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00"];

const liveChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("socarratt_live_channel") : null;
let mqttClient = null;
let lastServerSeq = 0;
const processedPatchIds = new Set();

const collapsedTicketsSet = new Set();
let allCollapsedMode = false;

// Protección para que ningún menú desplegable (<select>) ni campo de texto (<input>) se cierre mientras el usuario lo usa
let lastFormInteractionTs = 0;
function isUserInteractingWithForm() {
  const active = document.activeElement;
  if (active && (active.tagName === "SELECT" || active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
    return true;
  }
  if (Date.now() - lastFormInteractionTs < 4000) {
    return true;
  }
  return false;
}

document.addEventListener(
  "mousedown",
  (e) => {
    if (e.target && (e.target.tagName === "SELECT" || e.target.tagName === "OPTION" || e.target.tagName === "INPUT")) {
      lastFormInteractionTs = Date.now();
    }
  },
  true
);
document.addEventListener(
  "touchstart",
  (e) => {
    if (e.target && (e.target.tagName === "SELECT" || e.target.tagName === "OPTION" || e.target.tagName === "INPUT")) {
      lastFormInteractionTs = Date.now();
    }
  },
  true
);

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

// Formatea cualquier plato con nombre limpio tipo "Paella Valenciana 6px" o "2x Ración Arroz Negro"
function formatCleanItemLabel(item) {
  if (!item) return "";
  const rawName = String(item.name || "")
    .replace("Paella Valenciana Tradicional", "Paella Valenciana")
    .replace("Arroz al Horno (Arròs al Forn)", "Arroz al Horno")
    .replace("Arroz Negro con Sepia", "Arroz Negro")
    .replace("Arroz al Senyoret", "Arroz al Señoret")
    .replace("Fideuà Tradicional de Gandía", "Fideuá")
    .replace("Fideuà de Gandía", "Fideuá")
    .trim();

  if (item.isVarios || rawName.toLowerCase().startsWith("varios:")) {
    const priceTag = item.price !== undefined ? ` (${Number(item.price).toFixed(2)}€)` : "";
    return `${rawName}${priceTag}`;
  }

  // Si ya termina en "6px", "7px", etc. o empieza por "2x Ración"
  if (/\b\d+\s*px\b/i.test(rawName) || /^\d+x\s+raci/i.test(rawName)) {
    return rawName;
  }

  const fmt = String(item.format || item.highlight || "");
  const pxMatch = fmt.match(/(\d+)\s*(?:personas|pers|p\b|px)/i);
  if (pxMatch) {
    return `${rawName} ${pxMatch[1]}px`;
  }
  const racMatch = fmt.match(/(\d+)\s*raci/i);
  if (racMatch) {
    return `${racMatch[1]}x Ración ${rawName}`;
  }
  return rawName;
}

// ============================================================================
// BASE DE DATOS GEOGRÁFICA DE MADRID
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
  { keywords: ["príncipe pío", "principe pio", "debod", "ferraz", "28008", "bailén", "palacio", "fósforo", "fosforo"], zone: "Moncloa / Río / P. Pío", lat: 40.4220, lng: -3.7185, vehicle: "bike", outboundMin: 22, returnMin: 13 },
  { keywords: ["castellana", "chamartín", "chamartin", "28036", "28046", "cuzco", "plaza castilla", "bernabéu", "bernabeu", "nuevos ministerios"], zone: "Paseo Castellana / Chamartín", lat: 40.4585, lng: -3.6895, vehicle: "car", outboundMin: 29, returnMin: 19 },
  { keywords: ["alcalá", "alcala", "ventas", "28028", "guindalera", "manuel becerra", "francisco silvela", "diego de león", "alsacia"], zone: "Ventas / Guindalera", lat: 40.4315, lng: -3.6630, vehicle: "car", outboundMin: 28, returnMin: 18 },
  { keywords: ["cuatro caminos", "tetuán", "tetuan", "bravo murillo", "28020", "orense", "azca"], zone: "Tetuán / AZCA", lat: 40.4495, lng: -3.7030, vehicle: "car", outboundMin: 26, returnMin: 16 },
  { keywords: ["pirámides", "piramides", "arganzuela", "toledo", "imperial", "28005", "delicias", "legazpi", "28045"], zone: "Arganzuela / Madrid Río", lat: 40.4015, lng: -3.7060, vehicle: "car", outboundMin: 27, returnMin: 17 },
  { keywords: ["arturo soria", "hortaleza", "28033", "28043", "ciudad lineal", "28027", "prosperidad", "28002", "avenida de américa"], zone: "Prosperidad / Arturo Soria", lat: 40.4460, lng: -3.6660, vehicle: "car", outboundMin: 30, returnMin: 20 }
];

const DEFAULT_RIDERS = [
  { id: "rider-bici-1", name: "Dani (Bici 1)", vehicle: "bike", phone: "34611223301", lat: 40.4258, lng: -3.7018, gpsActive: false },
  { id: "rider-bici-2", name: "Álex (Bici 2)", vehicle: "bike", phone: "34611223302", lat: 40.4288, lng: -3.7042, gpsActive: false },
  { id: "rider-bici-3", name: "Javi (Bici 3)", vehicle: "bike", phone: "34611223303", lat: 40.4288, lng: -3.7042, gpsActive: false },
  { id: "rider-coche-1", name: "Marcos (Coche 1)", vehicle: "car", phone: "34611223304", lat: 40.4480, lng: -3.6930, gpsActive: false },
  { id: "rider-coche-2", name: "Roberto (Coche 2)", vehicle: "car", phone: "34611223305", lat: 40.4288, lng: -3.7042, gpsActive: false },
  { id: "rider-1792700056526", name: "XIOMAR", vehicle: "bike", phone: "34607169903", lat: 40.4288, lng: -3.7042, gpsActive: false }
];

function buildInitialDemoOrders() {
  const now = Date.now();
  const todayIso = getIsoDateOffset(0);
  const tomorrowIso = getIsoDateOffset(1);

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
        { name: "Paella Valenciana 8px", format: "8px", highlight: "Paella Valenciana 8px", price: 145.00, notes: "Llevar cambio de 50€ • 6º B" }
      ],
      total: 145.00,
      paymentSplit: { cash: 100.00, card: 45.00, transfer: 0, bizum: 0 },
      settled: false,
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
        { name: "3x Ración Arroz al Señoret", format: "3r", highlight: "3x Ración Arroz al Señoret", price: 39.00, notes: "Timbre 3º D" }
      ],
      total: 39.00,
      paymentSplit: { cash: 39.00, card: 0, transfer: 0, bizum: 0 },
      settled: false,
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
        { name: "Arroz al Horno 6px", format: "6px", highlight: "Arroz al Horno 6px", price: 121.00, notes: "" }
      ],
      total: 121.00,
      paymentSplit: { cash: 0, card: 121.00, transfer: 0, bizum: 0 },
      settled: false,
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
        { name: "2x Ración Paella Valenciana", format: "2r", highlight: "2x Ración Paella Valenciana", price: 26.00 },
        { name: "2x Ración Arroz Negro", format: "2r", highlight: "2x Ración Arroz Negro", price: 26.00 }
      ],
      total: 52.00,
      paymentSplit: { cash: 0, card: 0, transfer: 0, bizum: 52.00 },
      settled: false,
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
        { name: "Arroz del Turia 10px", format: "10px", highlight: "Arroz del Turia 10px", price: 185.00, notes: "Tocar al timbre 4º A" }
      ],
      total: 185.00,
      paymentSplit: { cash: 185.00, card: 0, transfer: 0, bizum: 0 },
      settled: false,
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
        { name: "Arroz al Señoret 7px", format: "7px", highlight: "Arroz al Señoret 7px", price: 130.00, notes: "Reserva para mañana" }
      ],
      total: 130.00,
      paymentSplit: { cash: 130.00, card: 0, transfer: 0, bizum: 0 },
      settled: false,
      status: "pending"
    }
  ];
}

// Estado global del KDS + Cierre de Caja
const kdsState = {
  orders: [],
  riders: [],
  cashAdjustments: [], // Movimientos manuales (+/-) en caja con fecha, concepto, importe y método
  cashBreakdown: {
    billsDirect: 0,
    coinsDirect: 0,
    denominations: {} // { "500": 0, "200": 0, ... }
  },
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
// CÁLCULO DE DISTANCIA Y TIEMPOS EN MADRID
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

  let carMin;
  if (distKm <= 4.0) {
    carMin = Math.max(3, Math.round(distKm * 3.15));
  } else {
    carMin = Math.round(12.0 + (distKm - 4.0) * 0.42);
  }

  const bikeMin = Math.max(2, Math.round(distKm * 3.7));
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
  const assignedRider = kdsState.riders.find((r) => r.id === order.riderId);
  const isBike =
    order.type !== "pickup" &&
    (order.vehicle === "bike" || (assignedRider && assignedRider.vehicle === "bike"));

  const rawOutbound = order.outboundMinutes || est.outboundMinutes || (isBike ? 12 : 25);
  const outboundBudget = isBike ? Math.min(15, Math.max(5, rawOutbound)) : rawOutbound;
  const returnBudget = isBike
    ? Math.min(12, Math.max(5, order.returnMinutes || est.returnMinutes || 10))
    : order.returnMinutes || est.returnMinutes || 15;
  const distanceKm = order.distanceKm !== undefined ? order.distanceKm : est.distanceKm;

  // Para bicis de carga (5-15 min): sale a las 13:00 y se entrega entre las 13:00 y 13:15h
  const deliveryTargetSlot = isBike
    ? `${order.slot}-${addMinutesToSlot(order.slot, 15)}`
    : addMinutesToSlot(order.slot, 30);
  const nextRoundSlot = isBike
    ? addMinutesToSlot(order.slot, 30)
    : addMinutesToSlot(order.slot, 60);

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
      semaphoreLabel = `🟡 Entregando (${outboundElapsedMin}/${outboundBudget}m)`;
    } else {
      const delayMin = Math.abs(remainingOutbound);
      semaphore = "red";
      semaphoreLabel = `🔴 +${delayMin}m sin marcar Entregado`;
      alertReason = `Lleva ${outboundElapsedMin} min desde que salió y NO ha pulsado "Entregado".`;
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
      alertReason = `Ya entregó hace ${returnElapsedMin} min. Lleva +${extraMin} min extra sin llegar al local.`;
    }
  } else if (order.status === "delivered") {
    if (order.departedAt && order.deliveredToClientAt) {
      outboundElapsedMin = Math.max(1, Math.round((order.deliveredToClientAt - order.departedAt) / 60000));
    }
    if (order.deliveredToClientAt && order.returnedToStoreAt) {
      returnElapsedMin = Math.max(1, Math.round((order.returnedToStoreAt - order.deliveredToClientAt) / 60000));
    }
    semaphore = "green";
    semaphoreLabel = "✅ Completado";
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

// Asegura que cada pedido tenga su objeto paymentSplit inicializado con su total
function ensureOrderPaymentSplit(order) {
  const total = Math.round((Number(order.total) || 0) * 100) / 100;
  if (!order.paymentSplit || typeof order.paymentSplit !== "object") {
    order.paymentSplit = { cash: total, card: 0, transfer: 0, bizum: 0 };
  } else {
    order.paymentSplit.cash = Math.round((Number(order.paymentSplit.cash) || 0) * 100) / 100;
    order.paymentSplit.card = Math.round((Number(order.paymentSplit.card) || 0) * 100) / 100;
    order.paymentSplit.transfer = Math.round((Number(order.paymentSplit.transfer) || 0) * 100) / 100;
    order.paymentSplit.bizum = Math.round((Number(order.paymentSplit.bizum) || 0) * 100) / 100;
    const sum = order.paymentSplit.cash + order.paymentSplit.card + order.paymentSplit.transfer + order.paymentSplit.bizum;
    if (sum === 0 && total > 0) {
      order.paymentSplit.cash = total;
    }
  }
  if (order.settled === undefined) order.settled = false;
  return order;
}

// ============================================================================
// PERSISTENCIA Y SINCRONIZACIÓN EN TIEMPO REAL
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
          const cleanedItems = Array.isArray(o.items)
            ? o.items.map((it) => {
                const cleanLbl = formatCleanItemLabel(it);
                return {
                  ...it,
                  name: cleanLbl,
                  highlight: cleanLbl,
                  option: "" // Quitar opción de punto del arroz/socarrat
                };
              })
            : [];
          return ensureOrderPaymentSplit({
            ...o,
            items: cleanedItems,
            date: normalizeOrderDate(o.date),
            lat: o.lat || est.lat,
            lng: o.lng || est.lng,
            distanceKm: o.distanceKm !== undefined ? o.distanceKm : est.distanceKm,
            outboundMinutes: o.outboundMinutes || est.outboundMinutes,
            returnMinutes: o.returnMinutes || est.returnMinutes,
            riderId: o.riderId !== undefined ? o.riderId : ""
          });
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

  // Cargar ajustes manuales de caja y desglose de efectivo
  try {
    const savedAdj = localStorage.getItem("socarratt_cash_adjustments");
    kdsState.cashAdjustments = savedAdj ? JSON.parse(savedAdj) : [];
  } catch (e) {
    kdsState.cashAdjustments = [];
  }

  try {
    const savedBrk = localStorage.getItem("socarratt_cash_breakdown");
    if (savedBrk) {
      kdsState.cashBreakdown = { ...kdsState.cashBreakdown, ...JSON.parse(savedBrk) };
    }
  } catch (e) {}
}

function saveCashData() {
  localStorage.setItem("socarratt_cash_adjustments", JSON.stringify(kdsState.cashAdjustments));
  localStorage.setItem("socarratt_cash_breakdown", JSON.stringify(kdsState.cashBreakdown));
  broadcastStateToMobile();
}

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
      kdsState.orders[oIdx] = ensureOrderPaymentSplit({
        ...kdsState.orders[oIdx],
        status: po.status || kdsState.orders[oIdx].status,
        departedAt: po.departedAt !== undefined ? po.departedAt : kdsState.orders[oIdx].departedAt,
        deliveredToClientAt: po.deliveredToClientAt !== undefined ? po.deliveredToClientAt : kdsState.orders[oIdx].deliveredToClientAt,
        deliveryProof: po.deliveryProof || kdsState.orders[oIdx].deliveryProof,
        returnedToStoreAt: po.returnedToStoreAt !== undefined ? po.returnedToStoreAt : kdsState.orders[oIdx].returnedToStoreAt
      });
    } else if (po.clientName && po.items) {
      // Nuevo pedido entrante desde la Carta Web de Clientes
      const est = estimateMadridRoute(po.address, po.type === "pickup");
      kdsState.orders.unshift(
        ensureOrderPaymentSplit({
          ...po,
          date: normalizeOrderDate(po.date),
          lat: po.lat || est.lat,
          lng: po.lng || est.lng,
          distanceKm: est.distanceKm,
          outboundMinutes: est.outboundMinutes,
          returnMinutes: est.returnMinutes
        })
      );
    }
    localStorage.setItem("socarratt_orders", JSON.stringify(kdsState.orders));
  }

  if (mqttClient && mqttClient.connected) {
    mqttClient.publish(
      MQTT_STATE_TOPIC,
      JSON.stringify({
        senderId: myKdsClientId,
        orders: kdsState.orders,
        riders: kdsState.riders,
        cashAdjustments: kdsState.cashAdjustments
      }),
      { qos: 0, retain: true }
    );
  }

  if (!isUserInteractingWithForm()) {
    renderAllKds();
  } else {
    updateLiveMapMarkers();
  }

  const syncEl = document.getElementById("gps-last-sync");
  if (syncEl && patchData.patchRider) {
    syncEl.textContent = `🛰️ GPS en vivo recibido de ${patchData.patchRider.name} (${formatClockTime(Date.now())}h)`;
  }

  if (updatedRiderId && patchData.focusMap && kdsMap && riderMarkersDict[updatedRiderId]) {
    kdsMap.flyTo(riderMarkersDict[updatedRiderId].getLatLng(), 15, { duration: 0.6 });
    riderMarkersDict[updatedRiderId].openPopup();
  }
}

function broadcastStateToMobile() {
  const payload = JSON.stringify({
    senderId: myKdsClientId,
    orders: kdsState.orders,
    riders: kdsState.riders,
    cashAdjustments: kdsState.cashAdjustments
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
                kdsState.orders = stateData.orders.map((o) =>
                  ensureOrderPaymentSplit({ ...o, date: normalizeOrderDate(o.date) })
                );
                localStorage.setItem("socarratt_orders", JSON.stringify(kdsState.orders));
              }
              if (Array.isArray(stateData.riders) && stateData.riders.length > 0) {
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
              if (Array.isArray(stateData.cashAdjustments)) {
                kdsState.cashAdjustments = stateData.cashAdjustments;
                localStorage.setItem("socarratt_cash_adjustments", JSON.stringify(kdsState.cashAdjustments));
              }
              if (!isUserInteractingWithForm()) {
                renderAllKds();
              }
            }
          } catch (err) {}
        }
      });
    } catch (e) {}
  }

  if (isLocalhostEnv()) {
    setInterval(() => {
      if (isUserInteractingWithForm()) return;
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
              kdsState.orders = data.orders.map((o) =>
                ensureOrderPaymentSplit({ ...o, date: normalizeOrderDate(o.date) })
              );
              localStorage.setItem("socarratt_orders", JSON.stringify(kdsState.orders));
            }
            if (!isUserInteractingWithForm()) {
              renderAllKds();
            }
          }
        })
        .catch(() => {});
    }, 2500);
  }
}

// ============================================================================
// MODAL PARA CONECTAR EL MÓVIL (CÓDIGO QR)
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
  const baseUrl = getActiveMobileBaseUrl();
  const fullUrl = `${baseUrl}${targetPath}`;
  const urlInput = document.getElementById("mobile-public-url-input");
  if (urlInput) urlInput.value = fullUrl;

  const qrImg = document.getElementById("mobile-qr-img");
  if (qrImg) {
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=6&data=${encodeURIComponent(fullUrl)}`;
  }

  const waBtn = document.getElementById("btn-send-wa-mobile");
  if (waBtn) {
    const msg = `🛵 *App de Repartidores y Cocina - Socarratt Madrid*\n\nPulsa en este enlace para abrir la pantalla en tiempo real:\n👉 ${fullUrl}`;
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
// FILTRADO POR FECHAS
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
      el.classList.toggle("active", Boolean(btnMap[id]));
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

function scrollToCashSection() {
  const sec = document.getElementById("cash-closing-section");
  if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ============================================================================
// INICIALIZACIÓN DEL PANEL DE COCINA
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {
  loadKdsData();
  updateDateFilterUI();
  initLiveGpsMap();
  initDenominationsCounterUI();
  renderAllKds();
  setupKdsListeners();
  initRealtimeMobileSync();

  // Temporizador suave que NUNCA interrumpe ni cierra desplegables (<select>) ni inputs
  setInterval(() => {
    if (isUserInteractingWithForm()) return;
    renderFleetCards();
    if (!isUserDraggingMap) {
      updateLiveMapMarkers();
    }
  }, 4000);
});

function renderAllKds() {
  updateDateFilterUI();
  renderFleetCards();
  renderKdsBoard();
  renderCashClosingSection();
  updateLiveMapMarkers();
}

// ============================================================================
// MAPA GPS DE MADRID
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
    .bindPopup("<strong>🥘 Socarratt Obrador Central</strong><br>Calle Manuela Malasaña, 5 (Madrid)")
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
      `🔥 Salida: <strong>${order.slot}h</strong> ➔ Entrega: <strong>${tel.deliveryTargetSlot}h</strong><br>` +
      `📏 ${tel.distanceKm} km`;

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
        statusShort = `🔄 Vuelta (${tel.returnElapsedMin}/${tel.returnBudget}m)`;
        lineCoords = [[rLat, rLng], [OBRADOR_COORDS.lat, OBRADOR_COORDS.lng]];
        isDashed = true;
      }
    } else if (rider.gpsActive || hasMovedFromBase) {
      pinBg = "#0284c7";
      statusShort = `🛰️ ${distFromBaseKm} km • ${travelTimes.summaryText}`;
      lineCoords = [[rLat, rLng], [OBRADOR_COORDS.lat, OBRADOR_COORDS.lng]];
      isDashed = true;
    } else {
      rLat = OBRADOR_COORDS.lat + (idx - 2) * 0.00045;
      rLng = OBRADOR_COORDS.lng + ((idx % 2) - 0.5) * 0.00065;
    }

    if (lineCoords) {
      if (riderLinesDict[rider.id]) {
        riderLinesDict[rider.id].setLatLngs(lineCoords);
        riderLinesDict[rider.id].setStyle({ color: pinBg, dashArray: isDashed ? "6, 6" : null });
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
      `<strong>${vEmoji} ${rider.name}</strong><br>` +
      `📞 ${rider.phone}<br>` +
      `📏 Distancia al Obrador: <strong>${distFromBaseKm} km</strong><br>` +
      `⏱️ <strong>🚗 ${travelTimes.carMin} min coche</strong> &bull; <strong>🚲 ${travelTimes.bikeMin} min bici</strong>`;

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

// ============================================================================
// TARJETAS DE REPARTIDORES EN DIRECTO
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

  let routeCount = 0;
  let onShiftCount = 0;
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
          ? `✅ TODOS EN TURNO (${onShiftCount}/${totalRiders})`
          : `👥 EN TURNO: ${onShiftCount} de ${totalRiders} repartidores`}
      </div>
      <div style="font-size:0.73rem; color:#cbd5e1;">
        ${missingShiftNames.length > 0 ? `⏳ Sin iniciar: <strong>${missingShiftNames.join(", ")}</strong>` : `🛰️ Flota operativa`}
      </div>
    </div>
  `;

  const cardsHtml = kdsState.riders
    .map((rider) => {
      const vEmoji = rider.vehicle === "bike" ? "🚲" : rider.vehicle === "moto" ? "🛵" : "🚗";
      const vLabel = rider.vehicle === "bike" ? "Bici" : rider.vehicle === "moto" ? "Moto" : "Coche";
      const rLat = Number(rider.lat) || OBRADOR_COORDS.lat;
      const rLng = Number(rider.lng) || OBRADOR_COORDS.lng;
      const distFromBaseKm = haversineKm(OBRADOR_COORDS.lat, OBRADOR_COORDS.lng, rLat, rLng);
      const travelTimes = calculateMadridTravelTimes(distFromBaseKm, rider.vehicle);

      const isRiderOnShift = Boolean(rider.onShift || rider.gpsActive);
      const shiftBadgeHtml = isRiderOnShift
        ? `<span style="background:rgba(16,185,129,0.2); color:#34d399; border:1px solid #10b981; padding:2px 7px; border-radius:999px; font-size:0.68rem; font-weight:800; margin-left:6px;">🟢 EN TURNO${rider.shiftTimeStr ? ` (${rider.shiftTimeStr}h)` : ''}</span>`
        : `<span style="background:rgba(100,116,139,0.25); color:#94a3b8; border:1px solid #475569; padding:2px 7px; border-radius:999px; font-size:0.68rem; font-weight:800; margin-left:6px;">⚪ SIN INICIAR</span>`;

      const activeOrder = kdsState.orders.find(
        (o) => o.riderId === rider.id && (o.status === "en_route" || o.status === "returning")
      );
      if (activeOrder) routeCount++;

      const upcomingOrders = getFilteredOrders()
        .filter((o) => o.riderId === rider.id && (o.status === "pending" || o.status === "cooking" || o.status === "ready"))
        .sort((a, b) => a.slot.localeCompare(b.slot));

      if (!activeOrder) {
        const nextAssigned = upcomingOrders[0];
        return `
          <div class="rider-live-card ${isRiderOnShift ? 'sem-green' : ''}" style="${!isRiderOnShift ? 'opacity:0.85; border-left:4px solid #475569;' : ''}">
            <div class="rider-card-top">
              <div class="rider-identity">
                <div class="rider-avatar" onclick="toggleRiderVehicle('${rider.id}')" style="cursor:pointer;">${vEmoji}</div>
                <div>
                  <span class="rider-name">${rider.name} ${shiftBadgeHtml}</span>
                  <span class="rider-vehicle-tag">
                    ${vLabel} &bull; ${isRiderOnShift && distFromBaseKm > 0.2
                      ? `📍 A <strong>${distFromBaseKm} km</strong> (🚗 ${travelTimes.carMin}m | 🚲 ${travelTimes.bikeMin}m)`
                      : isRiderOnShift
                      ? '📍 En Obrador Malasaña 5'
                      : '📴 Fuera de turno'}
                  </span>
                </div>
              </div>
            </div>

            ${nextAssigned ? `
              <div class="rider-next-round-banner">
                <span>📋 Ronda <strong>${nextAssigned.slot}h</strong>: ${nextAssigned.clientName} (${nextAssigned.total.toFixed(2)}€)</span>
                <button class="btn-mini btn-mini-orange" onclick="dispatchOrderNow('${nextAssigned.id}')">🚀 Dar Salida</button>
              </div>
            ` : ""}

            <div class="rider-card-actions">
              <div style="display:flex; gap:6px; flex-wrap:wrap;">
                <button class="btn-mini btn-mini-cyan" onclick="focusRiderOnMap('${rider.id}')">📍 Mapa</button>
                <button class="btn-mini" onclick="toggleRiderVehicle('${rider.id}')" title="Cambiar vehículo">🔄 ${vEmoji}</button>
                <button class="btn-mini" onclick="openEditSingleRider('${rider.id}')" title="Editar nombre, vehículo o teléfono">✏️ Editar</button>
                <button class="btn-mini" onclick="toggleRiderShiftFromPc('${rider.id}')">
                  ${isRiderOnShift ? '🔴 Cerrar Turno' : '🟢 Abrir Turno'}
                </button>
              </div>
            </div>
          </div>
        `;
      }

      const tel = getOrderTelemetry(activeOrder);
      return `
        <div class="rider-live-card sem-${tel.semaphore}">
          <div class="rider-card-top">
            <div class="rider-identity">
              <div class="rider-avatar">${vEmoji}</div>
              <div>
                <span class="rider-name">${rider.name} ${shiftBadgeHtml}</span>
                <span class="rider-vehicle-tag">Ronda ${activeOrder.slot}h ➔ Vuelve ${tel.nextRoundSlot}h</span>
              </div>
            </div>
            <span class="semaphore-badge ${tel.semaphore}">${tel.semaphoreLabel}</span>
          </div>

          <div class="rider-trip-box">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <strong>👤 ${activeOrder.clientName} (${activeOrder.total.toFixed(2)}€)</strong>
              <span style="color:#38bdf8; font-weight:800;">📏 A ${distFromBaseKm} km del local</span>
            </div>
            <div style="color:#94a3b8; font-size:0.73rem;">📍 ${activeOrder.address}</div>
          </div>

          <div class="rider-card-actions">
            <div style="display:flex; gap:5px; flex-wrap:wrap;">
              <button class="btn-mini btn-mini-cyan" onclick="focusRiderOnMap('${rider.id}')">📍 Mapa</button>
              <button class="btn-mini" onclick="openEditSingleRider('${rider.id}')" title="Editar datos del repartidor">✏️ Editar</button>
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
          </div>
        </div>
      `;
    })
    .join("");

  container.innerHTML = shiftSummaryBanner + cardsHtml;

  const fleetKpi = document.getElementById("kpi-fleet-status");
  if (fleetKpi) fleetKpi.textContent = `${onShiftCount}/${totalRiders} Turno (${routeCount} Ruta)`;
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
// TABLÓN DE COMANDAS POR FRANJAS DE 30 MIN (RESUMEN DE FUEGOS + DESPLIEGUE INDIVIDUAL + BICI 5-15 MIN)
// ============================================================================
const MAX_BURNERS_PER_SLOT = 15;

function countOrderPaellasAndRaciones(order) {
  let paellas = 0;
  let raciones = 0;
  (order.items || []).forEach((item) => {
    const lbl = formatCleanItemLabel(item);
    const racMatch = lbl.match(/^(\d+)x\s+Raci/i);
    if (racMatch) {
      raciones += Number(racMatch[1]) || 1;
    } else if (!item.isVarios && !lbl.toLowerCase().startsWith("varios:")) {
      paellas += 1;
    }
  });
  return { paellas, raciones };
}

function toggleOrderVehicleMode(orderId, event) {
  if (event) event.stopPropagation();
  const order = kdsState.orders.find((o) => o.id === orderId);
  if (!order || order.type === "pickup") return;

  order.vehicle = order.vehicle === "bike" ? "car" : "bike";
  if (order.vehicle === "bike") {
    order.outboundMinutes = Math.min(15, Math.max(5, order.outboundMinutes || 12));
    order.returnMinutes = Math.min(12, Math.max(5, order.returnMinutes || 10));
  } else {
    order.outboundMinutes = Math.max(20, order.outboundMinutes || 28);
    order.returnMinutes = Math.max(15, order.returnMinutes || 18);
  }
  saveKdsOrders();
  renderAllKds();
}

function renderKdsBoard() {
  const container = document.getElementById("kds-slots-grid");
  if (!container) return;

  const orders = getFilteredOrders();

  let totalPaellasGrandes = 0;
  let totalRaciones = 0;

  orders.forEach((o) => {
    if (o.status !== "delivered") {
      const counts = countOrderPaellasAndRaciones(o);
      totalPaellasGrandes += counts.paellas;
      totalRaciones += counts.raciones;
    }
  });

  const kpiPaellas = document.getElementById("kpi-paellas-count");
  const kpiRaciones = document.getElementById("kpi-raciones-count");
  if (kpiPaellas) kpiPaellas.textContent = totalPaellasGrandes;
  if (kpiRaciones) kpiRaciones.textContent = totalRaciones;

  container.innerHTML = KITCHEN_SLOTS.map((slot) => {
    const slotOrders = orders.filter((o) => o.slot === slot);
    const bikeWindowEnd = addMinutesToSlot(slot, 15);
    const carDeliverySlot = addMinutesToSlot(slot, 30);

    let slotPaellas = 0;
    let slotRaciones = 0;
    slotOrders.forEach((o) => {
      const c = countOrderPaellasAndRaciones(o);
      slotPaellas += c.paellas;
      slotRaciones += c.raciones;
    });

    const burnerPct = Math.min(100, Math.round((slotPaellas / MAX_BURNERS_PER_SLOT) * 100));
    const burnerColor =
      slotPaellas >= MAX_BURNERS_PER_SLOT
        ? "#ef4444"
        : slotPaellas >= 11
        ? "#f59e0b"
        : "#10b981";
    const burnerBg =
      slotPaellas >= MAX_BURNERS_PER_SLOT
        ? "rgba(239, 68, 68, 0.18)"
        : slotPaellas >= 11
        ? "rgba(245, 158, 11, 0.16)"
        : "rgba(16, 185, 129, 0.14)";

    return `
      <div class="slot-column" data-slot="${slot}">
        <div class="slot-header">
          <div class="slot-header-top">
            <div class="slot-time">
              <span>🔥 ${slot}h</span>
            </div>
            <div style="display:flex; gap:5px; align-items:center;">
              <span class="slot-badge" style="background:#1e293b; color:#f8fafc; border:1px solid #475569;">
                📋 ${slotOrders.length} ${slotOrders.length === 1 ? "pedido" : "pedidos"}
              </span>
              <span class="slot-badge" style="background:${burnerBg}; color:${burnerColor}; border:1px solid ${burnerColor}; font-weight:900;">
                🥘 ${slotPaellas}/${MAX_BURNERS_PER_SLOT} paellas
              </span>
            </div>
          </div>

          <!-- Barra de capacidad de fuegos (Máx 15 fuegos cada 30 min) -->
          <div style="margin-top:6px; background:#090d16; border:1px solid #1e293b; border-radius:8px; padding:5px 8px;">
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.72rem; font-weight:800; margin-bottom:4px;">
              <span style="color:${burnerColor};">
                🔥 Fuegos ocupados: <strong>${slotPaellas} de ${MAX_BURNERS_PER_SLOT}</strong>
                ${slotPaellas >= MAX_BURNERS_PER_SLOT ? " 🚨 ¡COMPLETO!" : ` (Libres: ${MAX_BURNERS_PER_SLOT - slotPaellas})`}
              </span>
              ${slotRaciones > 0 ? `<span style="color:#38bdf8;">🥡 +${slotRaciones} rac.</span>` : ""}
            </div>
            <div style="height:5px; width:100%; background:#1e293b; border-radius:999px; overflow:hidden;">
              <div style="height:100%; width:${burnerPct}%; background:${burnerColor}; transition:width 0.25s;"></div>
            </div>
          </div>

          <div class="slot-cycle-explain" style="margin-top:6px;">
            <span title="Las bicis de carga tardan 5 a 15 min">🚲 Bici: <strong>${slot}-${bikeWindowEnd}h</strong></span>
            <span title="Los coches tardan ~30 min">🚗 Coche: <strong>~${carDeliverySlot}h</strong></span>
          </div>
        </div>

        <div class="slot-orders-list">
          ${slotOrders.length === 0 ? `
            <div class="slot-empty">Sin pedidos a las ${slot}h (15 fuegos libres)</div>
          ` : slotOrders.map(renderTicketCard).join("")}
        </div>
      </div>
    `;
  }).join("");
}

function renderTicketCard(order) {
  const tel = getOrderTelemetry(order);
  const orderIsoDate = normalizeOrderDate(order.date);
  const isCollapsed = collapsedTicketsSet.has(order.id);

  // Nombres limpios solo con nombre y raciones/personas: ej. "Paella Valenciana 6px + Varios: Bebidas (5.00€)"
  const mainPaellaSummary = (order.items || [])
    .map((i) => formatCleanItemLabel(i))
    .join(" + ");

  const assignedRiderObj = kdsState.riders.find((r) => r.id === order.riderId);
  const isBikeOrder =
    order.type !== "pickup" &&
    (order.vehicle === "bike" || (assignedRiderObj && assignedRiderObj.vehicle === "bike"));

  const vIconCompact = order.type === "pickup" ? "🏢" : isBikeOrder ? "🚲" : "🚗";
  const riderShortName = assignedRiderObj
    ? `${isBikeOrder ? "🚲" : "🚗"} ${assignedRiderObj.name.split(" ")[0]}`
    : order.type === "pickup"
    ? "🏢 Recoge en tienda"
    : "⚠️ Sin repartidor";

  // Ventana de entrega clara según si es Bici (5-15 min: ej. 13:00-13:15h) o Coche (~30 min: ej. ~13:30h)
  const deliveryWindowBadge =
    order.type === "pickup"
      ? `<span style="color:#a855f7; font-weight:800; font-size:0.71rem;">🏢 Recoge ${order.slot}h</span>`
      : isBikeOrder
      ? `<span onclick="toggleOrderVehicleMode('${order.id}', event)" title="Pulsa para cambiar entre Bici (5-15 min) y Coche (~30 min)" style="background:rgba(56,189,248,0.15); color:#38bdf8; border:1px solid rgba(56,189,248,0.4); padding:1px 6px; border-radius:6px; font-weight:800; font-size:0.7rem; cursor:pointer;">🚲 Entrega ${order.slot}-${addMinutesToSlot(order.slot, 15)}h</span>`
      : `<span onclick="toggleOrderVehicleMode('${order.id}', event)" title="Pulsa para cambiar entre Coche (~30 min) y Bici (5-15 min)" style="background:rgba(245,158,11,0.15); color:#fbbf24; border:1px solid rgba(245,158,11,0.4); padding:1px 6px; border-radius:6px; font-weight:800; font-size:0.7rem; cursor:pointer;">🚗 Entrega ~${addMinutesToSlot(order.slot, 30)}h</span>`;

  let riderControlHtml = "";
  if (order.type !== "pickup" && order.vehicle !== "pickup") {
    const optionsHtml = kdsState.riders
      .map((r) => {
        const vEmoji = r.vehicle === "bike" ? "🚲" : r.vehicle === "moto" ? "🛵" : "🚗";
        return `<option value="${r.id}" ${order.riderId === r.id ? "selected" : ""}>${vEmoji} ${r.name}</option>`;
      })
      .join("");

    riderControlHtml = `
      <div class="ticket-rider-box" onclick="event.stopPropagation()">
        <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.73rem; font-weight:800; color:#cbd5e1; margin-bottom:5px; flex-wrap:wrap; gap:4px;">
          <span>🛵 Asignar Repartidor:</span>
          <button type="button" class="btn-mini" style="padding:2px 7px; font-size:0.68rem;" onclick="toggleOrderVehicleMode('${order.id}', event)">
            ${isBikeOrder ? "🚲 Modo Bici (13:00-13:15h) ➔ Cambiar a Coche" : "🚗 Modo Coche (~30 min) ➔ Cambiar a Bici"}
          </button>
        </div>

        <select class="ticket-rider-select" onfocus="lastFormInteractionTs = Date.now()" onmousedown="lastFormInteractionTs = Date.now()" onchange="assignRiderToOrder('${order.id}', this.value)">
          <option value="">-- Sin asignar repartidor --</option>
          ${optionsHtml}
        </select>
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
    <div class="ticket-card ${tel.semaphore === "red" ? "ticket-delayed" : ""} ${isCollapsed ? "collapsed" : ""}" id="ticket-${order.id}">
      
      <div class="ticket-compact-summary" onclick="toggleTicketCollapse('${order.id}', event)">
        <div class="compact-row-main">
          <div class="compact-paella-title">${mainPaellaSummary}</div>
          <div class="compact-price-tag" onclick="promptEditOrderPrice('${order.id}', event)" title="Haz clic para editar el precio (€) al instante" style="cursor:pointer;">
            ${Number(order.total || 0).toFixed(2)} € ✏️
          </div>
        </div>

        <div class="compact-street-row">
          <span>${vIconCompact}</span>
          <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">📍 ${order.address}</span>
          ${tel.distanceKm > 0 ? `<small style="color:#94a3b8; font-weight:700;">${tel.distanceKm}km</small>` : ""}
        </div>

        <div class="compact-bottom-bar" onclick="event.stopPropagation()">
          <div style="display:flex; align-items:center; gap:6px; font-size:0.73rem; color:#cbd5e1; font-weight:700; flex-wrap:wrap;">
            <span>${riderShortName}</span>
            ${deliveryWindowBadge}
          </div>

          <div style="display:flex; align-items:center; gap:5px;">
            <button class="ticket-status-btn ${currentSt.class}" style="padding:4px 8px; font-size:0.72rem;" onclick="cycleOrderStatus('${order.id}')">
              ${currentSt.label}
            </button>
            <button type="button" class="btn-collapse-toggle" onclick="toggleTicketCollapse('${order.id}', event)" title="Desplegar o plegar este pedido individualmente">
              ${isCollapsed ? "🔽 Desplegar" : "🔼 Plegar"}
            </button>
          </div>
        </div>
      </div>

      <div class="ticket-details-collapsible">
        <div class="ticket-header">
          <div>
            <span class="ticket-client">👤 ${order.clientName}</span>
            <span class="ticket-phone">📞 ${order.clientPhone}</span>
          </div>

          <div class="ticket-top-tools">
            <span class="ticket-date-pill">📅 ${formatShortDateBadge(orderIsoDate)}</span>
            <button type="button" class="btn-ticket-tool" onclick="openEditOrderModal('${order.id}')" title="Editar pedido completo">✏️</button>
            <button type="button" class="btn-ticket-tool delete" onclick="deleteOrderFromBoard('${order.id}')" title="Eliminar pedido">🗑️</button>
          </div>
        </div>

        ${riderControlHtml}

        <div class="ticket-items">
          ${(order.items || [])
            .map(
              (i) => `
            <div class="ticket-item-row" style="display:flex; justify-content:space-between; align-items:center;">
              <span>• <strong class="ticket-item-highlight">${formatCleanItemLabel(i)}</strong> ${i.notes ? `<em style="color:#fbbf24;">(${i.notes})</em>` : ""}</span>
              ${i.price !== undefined ? `<strong style="color:#cbd5e1;">${Number(i.price).toFixed(2)}€</strong>` : ""}
            </div>
          `
            )
            .join("")}
          ${order.notes ? `<div style="margin-top:4px; font-size:0.75rem; color:#fbbf24;">📝 Nota: ${order.notes}</div>` : ""}
        </div>
      </div>
    </div>
  `;
}

// Edición instantánea del precio desde la propia tarjeta del pedido
function promptEditOrderPrice(orderId, event) {
  if (event) event.stopPropagation();
  const order = kdsState.orders.find((o) => o.id === orderId);
  if (!order) return;

  const currentVal = Number(order.total || 0).toFixed(2);
  const input = prompt(`💶 Nuevo importe total (€) para el pedido de ${order.clientName}:`, currentVal);
  if (input === null) return;

  const parsed = parseFloat(String(input).replace(",", "."));
  if (isNaN(parsed)) {
    alert("Por favor, introduce un número válido.");
    return;
  }

  order.total = Math.round(parsed * 100) / 100;
  // Si solo tenía 1 método de pago activo, actualizarlo también automáticamente
  ensureOrderPaymentSplit(order);
  const sp = order.paymentSplit;
  const activeMethods = ["cash", "card", "transfer", "bizum"].filter((m) => sp[m] > 0);
  if (activeMethods.length <= 1) {
    const m = activeMethods[0] || "cash";
    sp.cash = 0;
    sp.card = 0;
    sp.transfer = 0;
    sp.bizum = 0;
    sp[m] = order.total;
  }

  saveKdsOrders();
  renderAllKds();
}

// ============================================================================
// CONSTRUCTOR DE PEDIDOS CON CARTA OFICIAL + TIENDAS (6€/10€) + VARIOS
// ============================================================================
let draftOrderItems = [];
let isTotalManuallyOverridden = false;

function getActiveModalRacionUnitPrice() {
  const delivType = document.getElementById("m-type")?.value || "delivery_whole";
  if (delivType !== "pickup") return 13;

  const storeId = document.getElementById("m-pickup-store")?.value || "malasana";
  const orderDate = document.getElementById("m-order-date")?.value || getIsoDateOffset(0);
  if (typeof getOfficialRacionPickupPrice === "function") {
    return getOfficialRacionPickupPrice(storeId, orderDate);
  }
  if (storeId === "ciudad-lineal" || storeId === "ventas") return 6;
  if (storeId === "imperial") {
    const parts = String(orderDate).split("-");
    const d = parts.length === 3 ? new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])) : new Date();
    const day = d.getDay();
    return day === 0 || day === 6 ? 10 : 6;
  }
  return 10;
}

function getBuilderCalculatedPrice() {
  const rice = document.getElementById("m-rice")?.value || "Paella Valenciana";
  const format = document.getElementById("m-format")?.value || "6px";

  if (format.endsWith("px")) {
    const px = parseInt(format, 10) || 6;
    if (typeof getOfficialPaellaPrice === "function") {
      return getOfficialPaellaPrice(rice, px);
    }
    const isSpecial = ["arroz al horno", "a banda con gambón", "arroz del turia"].includes(rice.toLowerCase());
    return (isSpecial ? 121 : 115) + Math.max(0, px - 6) * (isSpecial ? 16 : 15);
  } else {
    const qty = parseInt(format, 10) || 1;
    const unit = getActiveModalRacionUnitPrice();
    return qty * unit;
  }
}

function updateBuilderItemPreviewPrice() {
  const priceInput = document.getElementById("m-item-price");
  if (priceInput) {
    priceInput.value = getBuilderCalculatedPrice();
  }
}

function recalculateDraftRacionesPrices() {
  const unit = getActiveModalRacionUnitPrice();
  let changed = false;
  draftOrderItems.forEach((it) => {
    const racMatch = String(it.name || "").match(/^(\d+)x\s+Raci/i);
    if (racMatch) {
      const qty = Number(racMatch[1]) || 1;
      it.price = qty * unit;
      changed = true;
    }
  });
  if (changed) {
    isTotalManuallyOverridden = false;
    renderDraftOrderItems();
  }
}

function onModalDateOrStoreChange() {
  updateBuilderItemPreviewPrice();
  recalculateDraftRacionesPrices();
}

function onModalDeliveryTypeChange() {
  const typeVal = document.getElementById("m-type")?.value || "delivery_whole";
  const addrGroup = document.getElementById("m-address-group");
  const storeGroup = document.getElementById("m-pickup-store-group");
  if (addrGroup) {
    addrGroup.style.display = typeVal === "pickup" ? "none" : "block";
  }
  if (storeGroup) {
    storeGroup.style.display = typeVal === "pickup" ? "block" : "none";
  }
  updateBuilderItemPreviewPrice();
  recalculateDraftRacionesPrices();
}

function addDishToDraftOrder() {
  const rice = document.getElementById("m-rice")?.value || "Paella Valenciana";
  const format = document.getElementById("m-format")?.value || "6px";
  const priceInput = document.getElementById("m-item-price");
  const price = parseFloat(priceInput?.value) || getBuilderCalculatedPrice();

  let cleanLabel = "";
  if (format.endsWith("px")) {
    cleanLabel = `${rice} ${format}`;
  } else {
    const qty = parseInt(format, 10) || 1;
    cleanLabel = `${qty}x Ración ${rice}`;
  }

  draftOrderItems.push({
    name: cleanLabel,
    format: format,
    highlight: cleanLabel,
    price: Math.round(price * 100) / 100,
    isVarios: false
  });

  isTotalManuallyOverridden = false;
  renderDraftOrderItems();
}

function addVariosToDraftOrder() {
  const conceptInput = document.getElementById("m-varios-concept");
  const amountInput = document.getElementById("m-varios-amount");
  const concept = (conceptInput?.value || "").trim() || "Varios";
  const rawAmt = parseFloat(String(amountInput?.value || "").replace(",", "."));

  if (isNaN(rawAmt) || rawAmt === 0) {
    alert("Escribe un importe en € para el apartado de Varios (ej: 15 o -5).");
    if (amountInput) amountInput.focus();
    return;
  }

  const label = `Varios: ${concept}`;
  draftOrderItems.push({
    name: label,
    format: "varios",
    highlight: label,
    price: Math.round(rawAmt * 100) / 100,
    isVarios: true
  });

  if (conceptInput) conceptInput.value = "";
  if (amountInput) amountInput.value = "";

  isTotalManuallyOverridden = false;
  renderDraftOrderItems();
}

function updateDraftItemPrice(index, newVal) {
  if (!draftOrderItems[index]) return;
  const parsed = parseFloat(String(newVal).replace(",", ".")) || 0;
  draftOrderItems[index].price = Math.round(parsed * 100) / 100;
  isTotalManuallyOverridden = false;
  recalcDraftTotal();
}

function removeDraftItem(index) {
  draftOrderItems.splice(index, 1);
  isTotalManuallyOverridden = false;
  renderDraftOrderItems();
}

function recalcDraftTotal() {
  if (isTotalManuallyOverridden) return;
  const sum = draftOrderItems.reduce((acc, it) => acc + (Number(it.price) || 0), 0);
  const totalInput = document.getElementById("m-total");
  if (totalInput) {
    totalInput.value = (Math.round(sum * 100) / 100).toFixed(2);
  }
}

function onManualTotalEdited() {
  isTotalManuallyOverridden = true;
}

function renderDraftOrderItems() {
  const listEl = document.getElementById("m-draft-items-list");
  if (!listEl) return;

  if (draftOrderItems.length === 0) {
    listEl.innerHTML = `
      <div style="font-size:0.78rem; color:#94a3b8; padding:6px 8px; background:#1e293b; border-radius:8px;">
        ℹ️ Pulsa "➕ Añadir Plato" o directamente "💾 Guardar Comanda" para incluir el plato seleccionado arriba.
      </div>
    `;
    const totalInput = document.getElementById("m-total");
    if (totalInput && !isTotalManuallyOverridden) {
      totalInput.value = getBuilderCalculatedPrice().toFixed(2);
    }
    return;
  }

  listEl.innerHTML = draftOrderItems
    .map(
      (it, idx) => `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; background:#1e293b; padding:6px 10px; border-radius:8px; border:1px solid ${it.isVarios ? "#f59e0b" : "#334155"};">
        <span style="font-size:0.84rem; font-weight:800; color:${it.isVarios ? "#fbbf24" : "#f8fafc"}; flex:1;">
          ${it.isVarios ? "✨ " : "🥘 "}${it.name}
        </span>
        <div style="display:flex; align-items:center; gap:6px;">
          <input type="number" step="0.01" class="form-input" style="width:90px; padding:4px 8px; font-weight:800; text-align:right; color:#34d399;" value="${Number(it.price || 0).toFixed(2)}" oninput="updateDraftItemPrice(${idx}, this.value)">
          <span style="font-size:0.8rem; color:#94a3b8;">€</span>
          <button type="button" class="btn-mini btn-mini-danger" onclick="removeDraftItem(${idx})" style="padding:4px 8px;">✕</button>
        </div>
      </div>
    `
    )
    .join("");

  recalcDraftTotal();
}

function openManualOrderModal() {
  document.getElementById("manual-modal-title").textContent = "➕ Registrar Nuevo Pedido / Reserva";
  document.getElementById("m-edit-order-id").value = "";
  document.getElementById("m-client-name").value = "";
  document.getElementById("m-client-phone").value = "";
  document.getElementById("m-address").value = "";
  document.getElementById("m-notes").value = "";
  document.getElementById("m-varios-concept").value = "";
  document.getElementById("m-varios-amount").value = "";
  document.getElementById("m-payment-method").value = "cash";

  const defaultDate = kdsState.selectedFilterDate === "all" ? getIsoDateOffset(0) : kdsState.selectedFilterDate;
  document.getElementById("m-order-date").value = defaultDate;
  document.getElementById("m-type").value = "delivery_whole";
  document.getElementById("m-address-group").style.display = "block";
  const storeGroup = document.getElementById("m-pickup-store-group");
  if (storeGroup) storeGroup.style.display = "none";
  const vehModeEl = document.getElementById("m-delivery-vehicle-mode");
  if (vehModeEl) vehModeEl.value = "auto";

  draftOrderItems = [];
  isTotalManuallyOverridden = false;
  updateBuilderItemPreviewPrice();
  renderDraftOrderItems();

  document.getElementById("manual-order-modal").classList.add("active");
}

function openEditOrderModal(orderId) {
  const order = kdsState.orders.find((o) => o.id === orderId);
  if (!order) return;

  document.getElementById("manual-modal-title").textContent = `✏️ Editar Pedido de ${order.clientName}`;
  document.getElementById("m-edit-order-id").value = order.id;
  document.getElementById("m-client-name").value = order.clientName;
  document.getElementById("m-client-phone").value = order.clientPhone;
  document.getElementById("m-order-date").value = normalizeOrderDate(order.date);
  document.getElementById("m-slot").value = order.slot;
  document.getElementById("m-type").value = order.type === "pickup" ? "pickup" : "delivery_whole";
  document.getElementById("m-address-group").style.display = order.type === "pickup" ? "none" : "block";
  const storeGroup = document.getElementById("m-pickup-store-group");
  if (storeGroup) storeGroup.style.display = order.type === "pickup" ? "block" : "none";
  const storeSel = document.getElementById("m-pickup-store");
  if (storeSel && order.pickupStoreId) storeSel.value = order.pickupStoreId;

  const vehModeEl = document.getElementById("m-delivery-vehicle-mode");
  if (vehModeEl) {
    vehModeEl.value = order.vehicle === "bike" ? "bike" : order.vehicle === "car" ? "car" : "auto";
  }

  document.getElementById("m-address").value = order.type === "pickup" ? "" : order.address;
  document.getElementById("m-notes").value = order.notes || "";
  document.getElementById("m-varios-concept").value = "";
  document.getElementById("m-varios-amount").value = "";

  draftOrderItems = (order.items || []).map((it) => {
    const clean = formatCleanItemLabel(it);
    return {
      name: clean,
      format: it.format || "6px",
      highlight: clean,
      price: it.price !== undefined ? Number(it.price) : Number(order.total || 115),
      isVarios: Boolean(it.isVarios || clean.toLowerCase().startsWith("varios:"))
    };
  });

  isTotalManuallyOverridden = true;
  renderDraftOrderItems();
  document.getElementById("m-total").value = Number(order.total || 0).toFixed(2);

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
  const storeId = document.getElementById("m-pickup-store")?.value || "malasana";
  const vehMode = document.getElementById("m-delivery-vehicle-mode")?.value || "auto";
  const rawAddress = document.getElementById("m-address").value.trim();
  const notes = document.getElementById("m-notes").value.trim();
  const payMethod = document.getElementById("m-payment-method")?.value || "cash";

  if (!name || !phone) {
    alert("Por favor, introduce el nombre y teléfono del cliente.");
    return;
  }

  // Si el usuario escribió algo en el apartado de Varios pero no pulsó "➕ Sumar Varios", lo añadimos automáticamente
  const pendingVariosConcept = (document.getElementById("m-varios-concept")?.value || "").trim();
  const pendingVariosAmt = parseFloat(String(document.getElementById("m-varios-amount")?.value || "").replace(",", "."));

  if (draftOrderItems.length === 0) {
    addDishToDraftOrder();
  }

  if (!isNaN(pendingVariosAmt) && pendingVariosAmt !== 0) {
    const vLabel = `Varios: ${pendingVariosConcept || "Extra"}`;
    draftOrderItems.push({
      name: vLabel,
      format: "varios",
      highlight: vLabel,
      price: Math.round(pendingVariosAmt * 100) / 100,
      isVarios: true
    });
    if (!isTotalManuallyOverridden) {
      recalcDraftTotal();
    }
  }

  const totalVal = parseFloat(String(document.getElementById("m-total").value).replace(",", "."));
  const finalTotal = !isNaN(totalVal)
    ? Math.round(totalVal * 100) / 100
    : draftOrderItems.reduce((s, i) => s + (Number(i.price) || 0), 0);

  const isPickup = type === "pickup";
  const storeObj =
    typeof SOCARRATT_STORES !== "undefined"
      ? SOCARRATT_STORES.find((s) => s.id === storeId) || SOCARRATT_STORES[0]
      : null;
  const pickupAddressText = storeObj
    ? `Recoge en ${storeObj.name} (${storeObj.address})`
    : "Recoge en Obrador (Manuela Malasaña 5)";

  const address = isPickup ? pickupAddressText : rawAddress || "Domicilio Madrid";
  const routeEst = estimateMadridRoute(address, isPickup);

  let finalVehicle = isPickup ? "pickup" : routeEst.vehicle;
  let finalOutbound = routeEst.outboundMinutes;
  let finalReturn = routeEst.returnMinutes;

  if (!isPickup) {
    if (vehMode === "bike") {
      finalVehicle = "bike";
      finalOutbound = Math.min(15, Math.max(5, routeEst.outboundMinutes || 12));
      finalReturn = Math.min(12, Math.max(5, routeEst.returnMinutes || 10));
    } else if (vehMode === "car") {
      finalVehicle = "car";
      finalOutbound = Math.max(22, routeEst.outboundMinutes || 28);
      finalReturn = Math.max(15, routeEst.returnMinutes || 18);
    }
  }

  const initialSplit = { cash: 0, card: 0, transfer: 0, bizum: 0 };
  initialSplit[payMethod] = finalTotal;

  if (editId) {
    const existing = kdsState.orders.find((o) => o.id === editId);
    if (existing) {
      existing.clientName = name;
      existing.clientPhone = phone;
      existing.date = orderDate;
      existing.slot = slot;
      existing.type = type;
      existing.pickupStoreId = isPickup ? storeId : "";
      existing.vehicle = isPickup ? "pickup" : vehMode !== "auto" ? finalVehicle : existing.riderId ? existing.vehicle : finalVehicle;
      existing.address = address;
      existing.lat = routeEst.lat;
      existing.lng = routeEst.lng;
      existing.distanceKm = routeEst.distanceKm;
      existing.outboundMinutes = finalOutbound;
      existing.returnMinutes = finalReturn;
      existing.items = draftOrderItems.map((it) => ({ ...it }));
      existing.notes = notes;
      existing.total = finalTotal;
      ensureOrderPaymentSplit(existing);
      const sp = existing.paymentSplit;
      const sumSplit = sp.cash + sp.card + sp.transfer + sp.bizum;
      if (Math.abs(sumSplit - finalTotal) > 0.01) {
        existing.paymentSplit = initialSplit;
      }
    }
  } else {
    const newOrder = {
      id: `ord-tel-${Date.now()}`,
      clientName: name,
      clientPhone: phone,
      slot: slot,
      date: orderDate,
      type: type,
      pickupStoreId: isPickup ? storeId : "",
      vehicle: finalVehicle,
      riderId: "",
      address: address,
      lat: routeEst.lat,
      lng: routeEst.lng,
      distanceKm: routeEst.distanceKm,
      outboundMinutes: finalOutbound,
      returnMinutes: finalReturn,
      items: draftOrderItems.map((it) => ({ ...it })),
      notes: notes,
      total: finalTotal,
      paymentSplit: initialSplit,
      settled: false,
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
// SECCIÓN DE CIERRE DE REPARTIDORES Y ARQUEO DE CAJA FINAL DE TURNO
// ============================================================================
const BILL_DENOMS = [500, 200, 100, 50, 20, 10, 5];
const COIN_DENOMS = [2, 1, 0.5, 0.2, 0.1, 0.05];

function getActiveCashDateKey() {
  return kdsState.selectedFilterDate === "all" ? getIsoDateOffset(0) : kdsState.selectedFilterDate;
}

function getStoreTpvForActiveDate() {
  const dateKey = getActiveCashDateKey();
  if (kdsState.cashBreakdown?.tpvByDate && kdsState.cashBreakdown.tpvByDate[dateKey] !== undefined) {
    return Number(kdsState.cashBreakdown.tpvByDate[dateKey]) || 0;
  }
  return Number(kdsState.cashBreakdown?.storeTpv) || 0;
}

function onStoreTpvInput() {
  lastFormInteractionTs = Date.now();
  const rawVal = document.getElementById("cash-store-tpv-input")?.value || "";
  const val = Math.max(0, Math.round((parseFloat(String(rawVal).replace(",", ".")) || 0) * 100) / 100);
  const dateKey = getActiveCashDateKey();
  if (!kdsState.cashBreakdown.tpvByDate) kdsState.cashBreakdown.tpvByDate = {};
  kdsState.cashBreakdown.tpvByDate[dateKey] = val;
  kdsState.cashBreakdown.storeTpv = val;
  saveCashData();
  renderCashSummaryTotalsOnly();
  renderBossClosingReport();
}

function initDenominationsCounterUI() {
  const container = document.getElementById("denominations-container");
  if (!container) return;

  const denoms = [...BILL_DENOMS, ...COIN_DENOMS];
  container.innerHTML = denoms
    .map((d) => {
      const key = String(d);
      const count = Number(kdsState.cashBreakdown.denominations?.[key] || 0);
      const isBill = d >= 5;
      return `
        <div class="denom-item">
          <span class="denom-label ${isBill ? 'bill' : 'coin'}">${isBill ? "💵" : "🪙"} ${d >= 1 ? d + " €" : Math.round(d * 100) + " cts"}</span>
          <input type="number" min="0" step="1" class="form-input denom-input" value="${count || ""}" placeholder="0" oninput="onDenomCountChange('${key}', this.value)">
        </div>
      `;
    })
    .join("");

  const billsInput = document.getElementById("cash-bills-direct");
  const coinsInput = document.getElementById("cash-coins-direct");
  if (billsInput && kdsState.cashBreakdown.billsDirect) {
    billsInput.value = Number(kdsState.cashBreakdown.billsDirect).toFixed(2);
  }
  if (coinsInput && kdsState.cashBreakdown.coinsDirect) {
    coinsInput.value = Number(kdsState.cashBreakdown.coinsDirect).toFixed(2);
  }
  const tpvInput = document.getElementById("cash-store-tpv-input");
  const tpvVal = getStoreTpvForActiveDate();
  if (tpvInput) {
    tpvInput.value = tpvVal > 0 ? tpvVal.toFixed(2) : "";
  }
}

function onDenomCountChange(denomKey, rawCount) {
  if (!kdsState.cashBreakdown.denominations) kdsState.cashBreakdown.denominations = {};
  kdsState.cashBreakdown.denominations[denomKey] = Math.max(0, parseInt(rawCount, 10) || 0);

  let billsSum = 0;
  let coinsSum = 0;
  BILL_DENOMS.forEach((b) => {
    billsSum += b * (Number(kdsState.cashBreakdown.denominations[String(b)]) || 0);
  });
  COIN_DENOMS.forEach((c) => {
    coinsSum += c * (Number(kdsState.cashBreakdown.denominations[String(c)]) || 0);
  });

  kdsState.cashBreakdown.billsDirect = Math.round(billsSum * 100) / 100;
  kdsState.cashBreakdown.coinsDirect = Math.round(coinsSum * 100) / 100;

  const billsInput = document.getElementById("cash-bills-direct");
  const coinsInput = document.getElementById("cash-coins-direct");
  if (billsInput) billsInput.value = kdsState.cashBreakdown.billsDirect.toFixed(2);
  if (coinsInput) coinsInput.value = kdsState.cashBreakdown.coinsDirect.toFixed(2);

  saveCashData();
  renderCashSummaryTotalsOnly();
  renderBossClosingReport();
}

function onDirectBillsCoinsInput() {
  lastFormInteractionTs = Date.now();
  const billsVal = parseFloat(document.getElementById("cash-bills-direct")?.value) || 0;
  const coinsVal = parseFloat(document.getElementById("cash-coins-direct")?.value) || 0;
  kdsState.cashBreakdown.billsDirect = Math.round(billsVal * 100) / 100;
  kdsState.cashBreakdown.coinsDirect = Math.round(coinsVal * 100) / 100;
  saveCashData();
  renderCashSummaryTotalsOnly();
  renderBossClosingReport();
}

function resetCashBreakdown() {
  const tpvByDate = kdsState.cashBreakdown?.tpvByDate || {};
  const storeTpv = kdsState.cashBreakdown?.storeTpv || 0;
  kdsState.cashBreakdown = { billsDirect: 0, coinsDirect: 0, denominations: {}, tpvByDate, storeTpv };
  const billsInput = document.getElementById("cash-bills-direct");
  const coinsInput = document.getElementById("cash-coins-direct");
  if (billsInput) billsInput.value = "";
  if (coinsInput) coinsInput.value = "";
  initDenominationsCounterUI();
  saveCashData();
  renderCashSummaryTotalsOnly();
  renderBossClosingReport();
}

function openManualAdjustmentModal() {
  scrollToCashSection();
  const conceptEl = document.getElementById("adj-concept");
  if (conceptEl) conceptEl.focus();
}

function addCashManualMovement() {
  const conceptEl = document.getElementById("adj-concept");
  const amountEl = document.getElementById("adj-amount");
  const methodEl = document.getElementById("adj-method");

  const concept = (conceptEl?.value || "").trim();
  const amount = parseFloat(String(amountEl?.value || "").replace(",", "."));
  const method = methodEl?.value || "cash";

  if (!concept || isNaN(amount) || amount === 0) {
    alert("Introduce un concepto y un importe positivo o negativo (ej: -15 para un gasto o 20 para un ingreso).");
    return;
  }

  const activeDate = getActiveCashDateKey();
  kdsState.cashAdjustments.unshift({
    id: "adj-" + Date.now(),
    date: activeDate,
    concept,
    amount: Math.round(amount * 100) / 100,
    method,
    timeStr: formatClockTime(Date.now())
  });

  if (conceptEl) conceptEl.value = "";
  if (amountEl) amountEl.value = "";

  saveCashData();
  renderCashClosingSection();
}

function deleteCashAdjustment(adjId) {
  kdsState.cashAdjustments = kdsState.cashAdjustments.filter((a) => a.id !== adjId);
  saveCashData();
  renderCashClosingSection();
}

// Cambia el 100% del pago de un pedido a un único método (Efectivo, Tarjeta, Transferencia o Bizum)
function setOrderFullPaymentMethod(orderId, method) {
  const order = kdsState.orders.find((o) => o.id === orderId);
  if (!order) return;
  ensureOrderPaymentSplit(order);
  const total = Math.round((Number(order.total) || 0) * 100) / 100;
  order.paymentSplit = { cash: 0, card: 0, transfer: 0, bizum: 0 };
  order.paymentSplit[method] = total;
  saveKdsOrders();
  renderCashClosingSection();
}

// Edita uno de los 4 importes parciales (ej. 100€ en efectivo y 15€ en tarjeta)
function onOrderSplitInputChange(orderId, field, rawVal) {
  lastFormInteractionTs = Date.now();
  const order = kdsState.orders.find((o) => o.id === orderId);
  if (!order) return;
  ensureOrderPaymentSplit(order);

  const val = Math.max(0, Math.round((parseFloat(String(rawVal).replace(",", ".")) || 0) * 100) / 100);
  order.paymentSplit[field] = val;

  saveKdsOrders();
  renderCashSummaryTotalsOnly();
  updateOrderSplitStatusUI(orderId);
  renderBossClosingReport();
}

// Asigna automáticamente la diferencia restante de un pago mixto al método elegido (ej. "Poner resto 15€ en Tarjeta")
function assignRemainderToMethod(orderId, targetMethod) {
  const order = kdsState.orders.find((o) => o.id === orderId);
  if (!order) return;
  ensureOrderPaymentSplit(order);

  const total = Math.round((Number(order.total) || 0) * 100) / 100;
  const sp = order.paymentSplit;
  const othersSum = ["cash", "card", "transfer", "bizum"]
    .filter((m) => m !== targetMethod)
    .reduce((s, m) => s + (Number(sp[m]) || 0), 0);

  sp[targetMethod] = Math.max(0, Math.round((total - othersSum) * 100) / 100);
  saveKdsOrders();
  renderCashClosingSection();
}

function updateOrderTotalFromSettlement(orderId, rawVal) {
  lastFormInteractionTs = Date.now();
  const order = kdsState.orders.find((o) => o.id === orderId);
  if (!order) return;
  const newTotal = Math.max(0, Math.round((parseFloat(String(rawVal).replace(",", ".")) || 0) * 100) / 100);
  order.total = newTotal;
  ensureOrderPaymentSplit(order);

  const sp = order.paymentSplit;
  const active = ["cash", "card", "transfer", "bizum"].filter((m) => sp[m] > 0);
  if (active.length <= 1) {
    const m = active[0] || "cash";
    sp.cash = 0;
    sp.card = 0;
    sp.transfer = 0;
    sp.bizum = 0;
    sp[m] = newTotal;
  }

  saveKdsOrders();
  renderKdsBoard();
  renderCashSummaryTotalsOnly();
  updateOrderSplitStatusUI(orderId);
  renderBossClosingReport();
}

function updateOrderSplitStatusUI(orderId) {
  const order = kdsState.orders.find((o) => o.id === orderId);
  if (!order) return;
  const statusEl = document.getElementById(`split-diff-${orderId}`);
  if (!statusEl) return;

  const total = Math.round((Number(order.total) || 0) * 100) / 100;
  const sp = order.paymentSplit;
  const sum = Math.round((sp.cash + sp.card + sp.transfer + sp.bizum) * 100) / 100;
  const diff = Math.round((total - sum) * 100) / 100;

  if (Math.abs(diff) < 0.01) {
    statusEl.innerHTML = `<span style="color:#34d399; font-weight:800;">✓ Cuadra exacto (${sum.toFixed(2)} €)</span>`;
  } else if (diff > 0) {
    statusEl.innerHTML = `
      <span style="color:#fbbf24; font-weight:800;">⚠️ Faltan ${diff.toFixed(2)} € por asignar:</span>
      <button type="button" class="btn-mini" onclick="assignRemainderToMethod('${order.id}', 'card')" style="padding:2px 6px; font-size:0.7rem;">+${diff.toFixed(2)}€ a Tarjeta</button>
      <button type="button" class="btn-mini" onclick="assignRemainderToMethod('${order.id}', 'cash')" style="padding:2px 6px; font-size:0.7rem;">+${diff.toFixed(2)}€ a Efectivo</button>
      <button type="button" class="btn-mini" onclick="assignRemainderToMethod('${order.id}', 'bizum')" style="padding:2px 6px; font-size:0.7rem;">+${diff.toFixed(2)}€ a Bizum</button>
      <button type="button" class="btn-mini" onclick="assignRemainderToMethod('${order.id}', 'transfer')" style="padding:2px 6px; font-size:0.7rem;">+${diff.toFixed(2)}€ a Transf.</button>
    `;
  } else {
    statusEl.innerHTML = `<span style="color:#f87171; font-weight:800;">⚠️ La suma (${sum.toFixed(2)} €) supera el total en +${Math.abs(diff).toFixed(2)} €</span>`;
  }
}

function getOrderGroupKey(order) {
  if (order.riderId) return order.riderId;
  if (order.type === "pickup" || order.vehicle === "pickup") return "__PICKUP__";
  return "__UNASSIGNED__";
}

function getOrderGroupLabel(groupKey) {
  if (groupKey === "__PICKUP__") return "🏢 Recogida en Tienda";
  if (groupKey === "__UNASSIGNED__") return "⚠️ Sin Repartidor Asignado";
  const rObj = kdsState.riders.find((r) => r.id === groupKey);
  if (!rObj) return "🛵 Repartidor";
  const vEmoji = rObj.vehicle === "bike" ? "🚲" : rObj.vehicle === "moto" ? "🛵" : "🚗";
  return `${vEmoji} ${rObj.name}`;
}

// Pasa un pedido individual al otro lado de la tabla (Liquidados / Cierre Correcto) o lo reabre
function toggleOrderSettledOk(orderId, settledVal) {
  const order = kdsState.orders.find((o) => o.id === orderId);
  if (!order) return;
  ensureOrderPaymentSplit(order);
  order.settled = Boolean(settledVal);
  saveKdsOrders();
  renderAllKds();
}

// Marca como OK (Cierre Correcto) TODOS los pedidos de un repartidor y pasa su resumen desplegable al lado derecho
function settleAllRiderOrders(groupKey) {
  const orders = getFilteredOrders().filter((o) => getOrderGroupKey(o) === groupKey && !o.settled);
  orders.forEach((o) => {
    ensureOrderPaymentSplit(o);
    o.settled = true;
  });
  saveKdsOrders();
  renderAllKds();
}

// Reabre todos los pedidos liquidados de un repartidor para devolverlos al lado izquierdo
function unSettleAllRiderOrders(groupKey) {
  const orders = getFilteredOrders().filter((o) => getOrderGroupKey(o) === groupKey && o.settled);
  orders.forEach((o) => {
    o.settled = false;
  });
  saveKdsOrders();
  renderAllKds();
}

function getFilteredAdjustments() {
  return (kdsState.cashAdjustments || []).filter((a) => {
    const normDate = normalizeOrderDate(a.date);
    return kdsState.selectedFilterDate === "all" || normDate === kdsState.selectedFilterDate;
  });
}

function renderCashSummaryTotalsOnly() {
  const orders = getFilteredOrders();
  const adjustments = getFilteredAdjustments();
  const storeTpvAmount = getStoreTpvForActiveDate();

  let ordersCash = 0;
  let ordersCard = 0;
  let ordersTransfer = 0;
  let ordersBizum = 0;
  let settledTotal = 0;
  let pendingTotal = 0;

  orders.forEach((o) => {
    ensureOrderPaymentSplit(o);
    const sp = o.paymentSplit;
    ordersCash += Number(sp.cash) || 0;
    ordersCard += Number(sp.card) || 0;
    ordersTransfer += Number(sp.transfer) || 0;
    ordersBizum += Number(sp.bizum) || 0;
    if (o.settled) settledTotal += Number(o.total) || 0;
    else pendingTotal += Number(o.total) || 0;
  });

  let adjCash = 0;
  let adjCard = 0;
  let adjTransfer = 0;
  let adjBizum = 0;

  adjustments.forEach((a) => {
    const amt = Number(a.amount) || 0;
    if (a.method === "card") adjCard += amt;
    else if (a.method === "transfer") adjTransfer += amt;
    else if (a.method === "bizum") adjBizum += amt;
    else adjCash += amt;
  });

  const netCash = ordersCash + adjCash;
  const netCard = ordersCard + adjCard;
  const netTransfer = ordersTransfer + adjTransfer;
  const netBizum = ordersBizum + adjBizum;
  const grandTotal = netCash + netCard + netTransfer + netBizum + storeTpvAmount;

  const billsDirect = Number(kdsState.cashBreakdown.billsDirect) || 0;
  const coinsDirect = Number(kdsState.cashBreakdown.coinsDirect) || 0;
  const countedCash = billsDirect + coinsDirect;
  const cashDiff = Math.round((countedCash - netCash) * 100) / 100;

  const kpiCashEl = document.getElementById("kpi-cash-total");
  const kpiCashSub = document.getElementById("kpi-cash-sub");
  if (kpiCashEl) kpiCashEl.textContent = `${grandTotal.toFixed(2)} €`;
  if (kpiCashSub) {
    kpiCashSub.textContent = `💵 Efec: ${netCash.toFixed(0)}€ | 💳 Tarj: ${netCard.toFixed(0)}€ | 📟 TPV: ${storeTpvAmount.toFixed(0)}€`;
  }

  const diffBox = document.getElementById("cash-counted-diff-box");
  if (diffBox) {
    diffBox.innerHTML = `
      <div style="font-size:0.8rem; color:#cbd5e1;">
        💵 Billetes: <strong>${billsDirect.toFixed(2)}€</strong> + 🪙 Monedas: <strong>${coinsDirect.toFixed(2)}€</strong> = <strong style="color:#34d399; font-size:0.95rem;">${countedCash.toFixed(2)} € contados</strong>
      </div>
      <div style="font-size:0.78rem; margin-top:2px; font-weight:800; color:${Math.abs(cashDiff) < 0.01 ? "#34d399" : cashDiff > 0 ? "#38bdf8" : "#f87171"};">
        ${countedCash === 0
          ? `Esperado en cajón: ${netCash.toFixed(2)} €`
          : Math.abs(cashDiff) < 0.01
          ? `✅ CAJA CUADRADA AL CÉNTIMO (${netCash.toFixed(2)} €)`
          : cashDiff > 0
          ? `ℹ️ Sobran +${cashDiff.toFixed(2)} € en el cajón (Esperado: ${netCash.toFixed(2)} €)`
          : `⚠️ Faltan ${cashDiff.toFixed(2)} € en el cajón (Esperado: ${netCash.toFixed(2)} €)`}
      </div>
    `;
  }

  const cardsContainer = document.getElementById("cash-summary-cards");
  if (!cardsContainer) return;

  cardsContainer.innerHTML = `
    <div class="cash-kpi-card cash-card-green">
      <div class="cash-kpi-title">💵 EFECTIVO EN CAJA</div>
      <div class="cash-kpi-amount">${netCash.toFixed(2)} €</div>
      <div class="cash-kpi-detail">
        Repartos: ${ordersCash.toFixed(2)}€ ${adjCash !== 0 ? `| Ajustes: ${adjCash > 0 ? "+" : ""}${adjCash.toFixed(2)}€` : ""}<br>
        ${countedCash > 0 ? `Billetes: ${billsDirect.toFixed(2)}€ • Monedas: ${coinsDirect.toFixed(2)}€` : "Usa el desglose de Billetes y Monedas abajo"}
      </div>
    </div>

    <div class="cash-kpi-card cash-card-blue">
      <div class="cash-kpi-title">💳 TARJETA REPARTIDORES</div>
      <div class="cash-kpi-amount">${netCard.toFixed(2)} €</div>
      <div class="cash-kpi-detail">
        Pedidos: ${ordersCard.toFixed(2)}€ ${adjCard !== 0 ? `| Ajustes: ${adjCard > 0 ? "+" : ""}${adjCard.toFixed(2)}€` : ""}
      </div>
    </div>

    <div class="cash-kpi-card cash-card-purple">
      <div class="cash-kpi-title">🏦 TRANSF. + 📲 BIZUM</div>
      <div class="cash-kpi-amount">${(netTransfer + netBizum).toFixed(2)} €</div>
      <div class="cash-kpi-detail">
        🏦 Transf: ${netTransfer.toFixed(2)}€ &bull; 📲 Bizum: ${netBizum.toFixed(2)}€
      </div>
    </div>

    <div class="cash-kpi-card cash-card-cyan">
      <div class="cash-kpi-title">📟 TPV DE TIENDA (TIQUES)</div>
      <div class="cash-kpi-amount">${storeTpvAmount.toFixed(2)} €</div>
      <div class="cash-kpi-detail">
        Total tiques sacados hoy en TPV de tienda
      </div>
    </div>

    <div class="cash-kpi-card cash-card-gold">
      <div class="cash-kpi-title">💰 GRAN TOTAL DÍA</div>
      <div class="cash-kpi-amount">${grandTotal.toFixed(2)} €</div>
      <div class="cash-kpi-detail">
        ✅ Liquidados OK: <strong>${settledTotal.toFixed(2)}€</strong> | ⏳ Pend: <strong>${pendingTotal.toFixed(2)}€</strong><br>
        📟 Incluye TPV Tienda: <strong>${storeTpvAmount.toFixed(2)}€</strong>
      </div>
    </div>
  `;
}

function groupOrdersByRiderKey(ordersList) {
  const groups = {};
  ordersList.forEach((o) => {
    ensureOrderPaymentSplit(o);
    const gKey = getOrderGroupKey(o);
    if (!groups[gKey]) {
      groups[gKey] = {
        key: gKey,
        label: getOrderGroupLabel(gKey),
        orders: [],
        total: 0,
        cash: 0,
        card: 0,
        transfer: 0,
        bizum: 0
      };
    }
    groups[gKey].orders.push(o);
    groups[gKey].total += Number(o.total) || 0;
    groups[gKey].cash += Number(o.paymentSplit.cash) || 0;
    groups[gKey].card += Number(o.paymentSplit.card) || 0;
    groups[gKey].transfer += Number(o.paymentSplit.transfer) || 0;
    groups[gKey].bizum += Number(o.paymentSplit.bizum) || 0;
  });
  return Object.values(groups);
}

function renderCashClosingSection() {
  const tpvInput = document.getElementById("cash-store-tpv-input");
  if (tpvInput && document.activeElement !== tpvInput) {
    const tpvVal = getStoreTpvForActiveDate();
    tpvInput.value = tpvVal > 0 ? tpvVal.toFixed(2) : "";
  }

  renderCashSummaryTotalsOnly();

  // 1. Renderizar lista de ajustes manuales (+/-)
  const adjListEl = document.getElementById("cash-adjustments-list");
  const adjustments = getFilteredAdjustments();
  if (adjListEl) {
    if (adjustments.length === 0) {
      adjListEl.innerHTML = `<div style="font-size:0.76rem; color:#64748b; padding:6px 0;">Sin movimientos manuales hoy (puedes sumar extras o restar pagos con signo negativo, ej: -15).</div>`;
    } else {
      const methodLabels = { cash: "💵 Efectivo", card: "💳 Tarjeta", transfer: "🏦 Transf.", bizum: "📲 Bizum" };
      adjListEl.innerHTML = adjustments
        .map(
          (a) => `
          <div class="cash-adj-item">
            <div>
              <strong style="color:${a.amount >= 0 ? "#34d399" : "#f87171"};">
                ${a.amount >= 0 ? "+" : ""}${Number(a.amount).toFixed(2)} €
              </strong>
              <span style="font-size:0.75rem; background:#1e293b; padding:2px 6px; border-radius:4px; margin:0 6px;">${methodLabels[a.method] || "💵 Efectivo"}</span>
              <span style="color:#f8fafc; font-size:0.82rem;">${a.concept}</span>
            </div>
            <button type="button" class="btn-mini btn-mini-danger" onclick="deleteCashAdjustment('${a.id}')" style="padding:2px 7px;">✕</button>
          </div>
        `
        )
        .join("");
    }
  }

  // 2. Renderizar las dos columnas agrupadas por Repartidor:
  // Lado Izquierdo: Pendientes agrupados por Repartidor (con botón OK de todo el Repartidor)
  // Lado Derecho: Cierre Correcto / Liquidados con Desplegable del Total de cada Repartidor
  const orders = getFilteredOrders();
  const pendingOrders = orders.filter((o) => !o.settled);
  const settledOrders = orders.filter((o) => o.settled);

  const pendingCountEl = document.getElementById("settlement-pending-count");
  const doneCountEl = document.getElementById("settlement-done-count");
  if (pendingCountEl) pendingCountEl.textContent = pendingOrders.length;
  if (doneCountEl) doneCountEl.textContent = settledOrders.length;

  const pendingBody = document.getElementById("settlement-pending-body");
  const doneBody = document.getElementById("settlement-done-body");

  if (pendingBody) {
    if (pendingOrders.length === 0) {
      pendingBody.innerHTML = `
        <div class="settlement-empty">
          🎉 ¡Todos los repartidores y pedidos de esta fecha están cerrados y verificados en el lado derecho (OK)!
        </div>
      `;
    } else {
      const pendingGroups = groupOrdersByRiderKey(pendingOrders);
      pendingBody.innerHTML = pendingGroups
        .map(
          (grp) => `
          <div style="background:#090d16; border:1.5px solid #334155; border-radius:12px; padding:10px; margin-bottom:10px;">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; padding-bottom:8px; border-bottom:1px solid #1e293b; margin-bottom:8px;">
              <div>
                <div style="font-size:0.95rem; font-weight:900; color:#38bdf8;">
                  ${grp.label} <span style="font-size:0.76rem; color:#94a3b8; font-weight:700;">(${grp.orders.length} ${grp.orders.length === 1 ? "pedido" : "pedidos"})</span>
                </div>
                <div style="font-size:0.75rem; color:#cbd5e1; margin-top:2px;">
                  💵 Efectivo: <strong>${grp.cash.toFixed(2)}€</strong> &bull;
                  💳 Tarjeta: <strong>${grp.card.toFixed(2)}€</strong> &bull;
                  🏦 Transf: <strong>${grp.transfer.toFixed(2)}€</strong> &bull;
                  📲 Bizum: <strong>${grp.bizum.toFixed(2)}€</strong>
                </div>
              </div>
              <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                <strong style="font-size:1.05rem; color:#fbbf24;">Total: ${grp.total.toFixed(2)} €</strong>
                <button type="button" class="btn-settle-ok" onclick="settleAllRiderOrders('${grp.key}')" title="Dar el OK al total de este repartidor y pasarlo a Cierre Correcto">
                  ✅ OK CIERRE ${grp.label.toUpperCase()} (${grp.total.toFixed(2)}€) ➔
                </button>
              </div>
            </div>

            <div style="display:flex; flex-direction:column; gap:8px;">
              ${grp.orders.map((o) => renderSettlementOrderCard(o, false)).join("")}
            </div>
          </div>
        `
        )
        .join("");

      pendingOrders.forEach((o) => updateOrderSplitStatusUI(o.id));
    }
  }

  if (doneBody) {
    if (settledOrders.length === 0) {
      doneBody.innerHTML = `
        <div class="settlement-empty">
          Pulsa <strong>"✅ OK CIERRE"</strong> en cualquier repartidor de la izquierda para pasar su resumen desplegable a este lado.
        </div>
      `;
    } else {
      const settledGroups = groupOrdersByRiderKey(settledOrders);
      doneBody.innerHTML = settledGroups
        .map(
          (grp) => `
          <details class="settled-rider-summary-pill" style="margin-bottom:8px; cursor:pointer; background:rgba(16, 185, 129, 0.1); border:1.5px solid #10b981; border-radius:12px; padding:10px 12px;">
            <summary style="list-style:none; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; outline:none;">
              <div>
                <div style="font-size:0.95rem; font-weight:900; color:#34d399; display:flex; align-items:center; gap:6px;">
                  <span>✅ ${grp.label}</span>
                  <span style="font-size:0.75rem; background:rgba(16,185,129,0.2); color:#a7f3d0; padding:2px 8px; border-radius:999px;">
                    ${grp.orders.length} ${grp.orders.length === 1 ? "pedido" : "pedidos"} &bull; 🔽 Desplegar detalle
                  </span>
                </div>
                <div style="font-size:0.78rem; color:#e2e8f0; margin-top:4px;">
                  💵 Efectivo: <strong style="color:#34d399;">${grp.cash.toFixed(2)}€</strong> &nbsp;|&nbsp;
                  💳 Tarjeta: <strong style="color:#60a5fa;">${grp.card.toFixed(2)}€</strong> &nbsp;|&nbsp;
                  🏦 Transf: <strong style="color:#c084fc;">${grp.transfer.toFixed(2)}€</strong> &nbsp;|&nbsp;
                  📲 Bizum: <strong style="color:#38bdf8;">${grp.bizum.toFixed(2)}€</strong>
                </div>
              </div>
              <div style="display:flex; align-items:center; gap:8px;">
                <strong style="color:#34d399; font-size:1.15rem;">${grp.total.toFixed(2)} €</strong>
                <button type="button" class="btn-mini" onclick="event.stopPropagation(); unSettleAllRiderOrders('${grp.key}')" title="Reabrir todos los pedidos de este repartidor">
                  ↩️ Reabrir
                </button>
              </div>
            </summary>

            <div style="margin-top:10px; padding-top:10px; border-top:1px dashed rgba(16, 185, 129, 0.35); display:flex; flex-direction:column; gap:6px;">
              ${grp.orders.map((o) => renderSettlementOrderCard(o, true)).join("")}
            </div>
          </details>
        `
        )
        .join("");
    }
  }

  // 3. Renderizar el Cuadro Resumen Ejecutivo Final para mandar Captura a los Jefes
  renderBossClosingReport();
}

function renderBossClosingReport() {
  const container = document.getElementById("boss-closing-report-container");
  if (!container) return;

  const orders = getFilteredOrders();
  const adjustments = getFilteredAdjustments();
  const storeTpvAmount = getStoreTpvForActiveDate();
  const riderGroups = groupOrdersByRiderKey(orders);

  let totalRidersCash = 0;
  let totalRidersCard = 0;
  let totalRidersTransfer = 0;
  let totalRidersBizum = 0;
  let totalRidersAll = 0;

  riderGroups.forEach((g) => {
    totalRidersCash += g.cash;
    totalRidersCard += g.card;
    totalRidersTransfer += g.transfer;
    totalRidersBizum += g.bizum;
    totalRidersAll += g.total;
  });

  let adjCash = 0;
  let adjCard = 0;
  let adjTransfer = 0;
  let adjBizum = 0;
  adjustments.forEach((a) => {
    const amt = Number(a.amount) || 0;
    if (a.method === "card") adjCard += amt;
    else if (a.method === "transfer") adjTransfer += amt;
    else if (a.method === "bizum") adjBizum += amt;
    else adjCash += amt;
  });

  const finalCash = totalRidersCash + adjCash;
  const finalCard = totalRidersCard + adjCard;
  const finalTransfer = totalRidersTransfer + adjTransfer;
  const finalBizum = totalRidersBizum + adjBizum;
  const grandTotalDay = finalCash + finalCard + finalTransfer + finalBizum + storeTpvAmount;

  const billsDirect = Number(kdsState.cashBreakdown.billsDirect) || 0;
  const coinsDirect = Number(kdsState.cashBreakdown.coinsDirect) || 0;
  const countedCash = billsDirect + coinsDirect;

  // Filas por categoría (Tarjeta: Nombre repartidor y total; Efectivo: Nombre repartidor y total, etc.)
  const cardRowsHtml = riderGroups
    .filter((g) => g.card > 0)
    .map(
      (g) => `
      <div style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px dashed #1e293b; font-size:0.84rem;">
        <span>${g.label}</span>
        <strong style="color:#60a5fa;">${g.card.toFixed(2)} €</strong>
      </div>
    `
    )
    .join("");

  const cashRowsHtml = riderGroups
    .filter((g) => g.cash > 0)
    .map(
      (g) => `
      <div style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px dashed #1e293b; font-size:0.84rem;">
        <span>${g.label}</span>
        <strong style="color:#34d399;">${g.cash.toFixed(2)} €</strong>
      </div>
    `
    )
    .join("");

  const bizumTransfRowsHtml = riderGroups
    .filter((g) => g.bizum > 0 || g.transfer > 0)
    .map(
      (g) => `
      <div style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px dashed #1e293b; font-size:0.84rem;">
        <span>${g.label} ${g.bizum > 0 ? `(Bizum: ${g.bizum.toFixed(2)}€)` : ""} ${g.transfer > 0 ? `(Transf: ${g.transfer.toFixed(2)}€)` : ""}</span>
        <strong style="color:#c084fc;">${(g.bizum + g.transfer).toFixed(2)} €</strong>
      </div>
    `
    )
    .join("");

  const allRidersTotalsHtml = riderGroups
    .map((g) => {
      const allSettled = g.orders.every((o) => o.settled);
      return `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:5px 8px; background:#090d16; border-radius:6px; border:1px solid ${allSettled ? "#10b981" : "#334155"}; font-size:0.82rem;">
          <div>
            <strong>${allSettled ? "✅" : "⏳"} ${g.label}</strong>
            <span style="color:#94a3b8; font-size:0.74rem; margin-left:6px;">
              (Efec: ${g.cash.toFixed(0)}€ | Tarj: ${g.card.toFixed(0)}€${g.bizum > 0 ? ` | Bizum: ${g.bizum.toFixed(0)}€` : ""}${g.transfer > 0 ? ` | Transf: ${g.transfer.toFixed(0)}€` : ""})
            </span>
          </div>
          <strong style="color:#fbbf24; font-size:0.92rem;">${g.total.toFixed(2)} €</strong>
        </div>
      `;
    })
    .join("");

  container.innerHTML = `
    <div id="boss-screenshot-card" style="background:linear-gradient(145deg, #0b1120 0%, #0f172a 100%); border:2px solid #f59e0b; border-radius:16px; padding:16px; box-shadow:0 12px 30px rgba(0,0,0,0.45);">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; padding-bottom:12px; border-bottom:2px solid #1e293b; margin-bottom:14px;">
        <div>
          <div style="font-size:0.74rem; font-weight:900; color:#fbbf24; text-transform:uppercase; letter-spacing:0.06em;">
            📸 RESUMEN OFICIAL DE CIERRE DE TURNO (LISTO PARA CAPTURA A JEFES)
          </div>
          <h3 style="font-size:1.18rem; font-weight:900; color:#f8fafc; margin-top:2px;">
            🥘 Socarratt Madrid &bull; Cierre ${formatHumanDate(kdsState.selectedFilterDate)}
          </h3>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button type="button" class="btn-kds btn-kds-primary" onclick="copyBossClosingSummaryText()" style="background:#10b981; border-color:#059669; color:#052e16; font-weight:900;">
            📋 Copiar Resumen para WhatsApp Jefes
          </button>
        </div>
      </div>

      <!-- 4 Bloques separados por Categoría para la captura de los Jefes -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:12px; margin-bottom:14px;">
        
        <!-- 1. TARJETA POR REPARTIDOR -->
        <div style="background:#090d16; border:1px solid #1d4ed8; border-radius:12px; padding:12px;">
          <div style="font-size:0.82rem; font-weight:900; color:#60a5fa; margin-bottom:8px; border-bottom:1px solid #1e293b; padding-bottom:4px;">
            💳 1. TARJETA (POR REPARTIDOR)
          </div>
          ${cardRowsHtml || `<div style="font-size:0.78rem; color:#64748b; padding:4px 0;">Sin cobros en tarjeta de repartidores</div>`}
          ${adjCard !== 0 ? `<div style="display:flex; justify-content:space-between; font-size:0.8rem; color:#93c5fd; padding-top:4px;"><span>Ajustes Tarjeta:</span><strong>${adjCard > 0 ? "+" : ""}${adjCard.toFixed(2)} €</strong></div>` : ""}
          <div style="display:flex; justify-content:space-between; margin-top:8px; padding-top:6px; border-top:1.5px solid #1e3a8a; font-weight:900; font-size:0.95rem; color:#60a5fa;">
            <span>TOTAL TARJETA REPARTIDORES:</span>
            <span>${finalCard.toFixed(2)} €</span>
          </div>
        </div>

        <!-- 2. EFECTIVO POR REPARTIDOR + CAJA APARTE -->
        <div style="background:#090d16; border:1px solid #059669; border-radius:12px; padding:12px;">
          <div style="font-size:0.82rem; font-weight:900; color:#34d399; margin-bottom:8px; border-bottom:1px solid #1e293b; padding-bottom:4px;">
            💵 2. EFECTIVO (REPARTIDORES Y CAJA)
          </div>
          ${cashRowsHtml || `<div style="font-size:0.78rem; color:#64748b; padding:4px 0;">Sin cobros en efectivo de repartidores</div>`}
          ${adjustments
            .filter((a) => !a.method || a.method === "cash")
            .map(
              (a) => `
              <div style="display:flex; justify-content:space-between; font-size:0.79rem; color:${a.amount >= 0 ? "#6ee7b7" : "#fca5a5"}; padding:3px 0;">
                <span>${a.amount >= 0 ? "➕" : "➖"} ${a.concept}</span>
                <strong>${a.amount >= 0 ? "+" : ""}${Number(a.amount).toFixed(2)} €</strong>
              </div>
            `
            )
            .join("")}
          ${countedCash > 0 ? `
            <div style="font-size:0.74rem; color:#a7f3d0; margin-top:4px; background:rgba(16,185,129,0.1); padding:4px 6px; border-radius:6px;">
              💵 Billetes: <strong>${billsDirect.toFixed(2)}€</strong> + 🪙 Monedas: <strong>${coinsDirect.toFixed(2)}€</strong> = <strong>${countedCash.toFixed(2)}€</strong>
            </div>
          ` : ""}
          <div style="display:flex; justify-content:space-between; margin-top:8px; padding-top:6px; border-top:1.5px solid #065f46; font-weight:900; font-size:0.95rem; color:#34d399;">
            <span>TOTAL EFECTIVO CAJA:</span>
            <span>${finalCash.toFixed(2)} €</span>
          </div>
        </div>

        <!-- 3. BIZUM / TRANSFERENCIA + TPV TIENDA -->
        <div style="background:#090d16; border:1px solid #7c3aed; border-radius:12px; padding:12px; display:flex; flex-direction:column; justify-content:space-between;">
          <div>
            <div style="font-size:0.82rem; font-weight:900; color:#c084fc; margin-bottom:8px; border-bottom:1px solid #1e293b; padding-bottom:4px;">
              📲 3. BIZUM / TRANSF. &bull; 📟 TPV TIENDA
            </div>
            ${bizumTransfRowsHtml || `<div style="font-size:0.78rem; color:#64748b; padding:4px 0;">Sin cobros en Bizum / Transferencia</div>`}
            <div style="display:flex; justify-content:space-between; margin-top:6px; padding-top:4px; border-top:1px dashed #334155; font-size:0.84rem; color:#e9d5ff;">
              <span>Subtotal Bizum + Transf:</span>
              <strong>${(finalBizum + finalTransfer).toFixed(2)} €</strong>
            </div>
          </div>

          <div style="margin-top:10px; padding-top:8px; border-top:1.5px solid #3b0764; display:flex; justify-content:space-between; align-items:center; font-weight:900; font-size:0.95rem; color:#38bdf8;">
            <span>📟 TPV TIENDA (TIQUES DÍA):</span>
            <span>${storeTpvAmount.toFixed(2)} €</span>
          </div>
        </div>
      </div>

      <!-- Cierre total por cada Repartidor + Gran Total -->
      <div style="background:#111827; border:1px solid #334155; border-radius:12px; padding:10px 12px;">
        <div style="font-size:0.76rem; font-weight:900; color:#cbd5e1; text-transform:uppercase; margin-bottom:6px;">
          🛵 RESUMEN CIERRE TOTAL POR REPARTIDOR:
        </div>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:6px; margin-bottom:10px;">
          ${allRidersTotalsHtml || `<div style="font-size:0.78rem; color:#64748b;">No hay pedidos registrados en esta fecha.</div>`}
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; padding-top:10px; border-top:2px solid #f59e0b;">
          <div style="font-size:0.84rem; color:#e2e8f0;">
            🛵 Total Repartidores: <strong>${(finalCash + finalCard + finalTransfer + finalBizum).toFixed(2)} €</strong>
            &nbsp;+&nbsp;
            📟 TPV Tienda: <strong>${storeTpvAmount.toFixed(2)} €</strong>
          </div>
          <div style="font-size:1.25rem; font-weight:900; color:#fbbf24;">
            💰 GRAN TOTAL DEL DÍA: ${grandTotalDay.toFixed(2)} €
          </div>
        </div>
      </div>
    </div>
  `;
}

function copyBossClosingSummaryText() {
  const orders = getFilteredOrders();
  const adjustments = getFilteredAdjustments();
  const storeTpvAmount = getStoreTpvForActiveDate();
  const riderGroups = groupOrdersByRiderKey(orders);

  let adjCash = 0;
  let adjCard = 0;
  let adjTransfer = 0;
  let adjBizum = 0;
  adjustments.forEach((a) => {
    const amt = Number(a.amount) || 0;
    if (a.method === "card") adjCard += amt;
    else if (a.method === "transfer") adjTransfer += amt;
    else if (a.method === "bizum") adjBizum += amt;
    else adjCash += amt;
  });

  let totalRidersCash = 0;
  let totalRidersCard = 0;
  let totalRidersTransfer = 0;
  let totalRidersBizum = 0;
  riderGroups.forEach((g) => {
    totalRidersCash += g.cash;
    totalRidersCard += g.card;
    totalRidersTransfer += g.transfer;
    totalRidersBizum += g.bizum;
  });

  const finalCash = totalRidersCash + adjCash;
  const finalCard = totalRidersCard + adjCard;
  const finalTransfer = totalRidersTransfer + adjTransfer;
  const finalBizum = totalRidersBizum + adjBizum;
  const grandTotalDay = finalCash + finalCard + finalTransfer + finalBizum + storeTpvAmount;

  let txt = `📊 *CIERRE DE TURNO SOCARRATT (${formatHumanDate(kdsState.selectedFilterDate)})*\n\n`;

  txt += `💳 *TARJETA (POR REPARTIDOR):*\n`;
  const cardGroups = riderGroups.filter((g) => g.card > 0);
  if (cardGroups.length === 0) txt += `• Sin cobros en tarjeta\n`;
  else cardGroups.forEach((g) => (txt += `• ${g.label}: *${g.card.toFixed(2)} €*\n`));
  txt += `👉 *Total Tarjeta Repartidores: ${finalCard.toFixed(2)} €*\n\n`;

  txt += `💵 *EFECTIVO (POR REPARTIDOR Y CAJA):*\n`;
  const cashGroups = riderGroups.filter((g) => g.cash > 0);
  if (cashGroups.length === 0) txt += `• Sin cobros en efectivo\n`;
  else cashGroups.forEach((g) => (txt += `• ${g.label}: *${g.cash.toFixed(2)} €*\n`));
  adjustments
    .filter((a) => !a.method || a.method === "cash")
    .forEach((a) => {
      txt += `• ${a.amount >= 0 ? "➕" : "➖"} ${a.concept}: *${a.amount >= 0 ? "+" : ""}${Number(a.amount).toFixed(2)} €*\n`;
    });
  txt += `👉 *Total Efectivo Caja: ${finalCash.toFixed(2)} €*\n\n`;

  if (finalBizum > 0 || finalTransfer > 0) {
    txt += `📲 *BIZUM Y TRANSFERENCIA:*\n`;
    riderGroups
      .filter((g) => g.bizum > 0 || g.transfer > 0)
      .forEach((g) => {
        txt += `• ${g.label}: *${(g.bizum + g.transfer).toFixed(2)} €*\n`;
      });
    txt += `👉 *Total Bizum/Transf: ${(finalBizum + finalTransfer).toFixed(2)} €*\n\n`;
  }

  txt += `🛵 *CIERRE TOTAL POR REPARTIDOR:*\n`;
  riderGroups.forEach((g) => {
    txt += `• ${g.label}: *${g.total.toFixed(2)} €* (Efec: ${g.cash.toFixed(0)}€ | Tarj: ${g.card.toFixed(0)}€)\n`;
  });

  txt += `\n📟 *TPV DE TIENDA (TIQUES DÍA):* *${storeTpvAmount.toFixed(2)} €*\n`;
  txt += `---------------------------------\n`;
  txt += `💰 *GRAN TOTAL DEL DÍA:* *${grandTotalDay.toFixed(2)} €*`;

  navigator.clipboard?.writeText(txt);
  alert("✅ Resumen de cierre copiado al portapapeles listo para pegar en el WhatsApp de los jefes:\n\n" + txt);
}

function renderSettlementOrderCard(order, isSettled) {
  ensureOrderPaymentSplit(order);
  const sp = order.paymentSplit;
  const dishesText = (order.items || []).map((i) => formatCleanItemLabel(i)).join(" + ");

  if (isSettled) {
    const parts = [];
    if (sp.cash > 0) parts.push(`💵 Efectivo: <strong>${sp.cash.toFixed(2)}€</strong>`);
    if (sp.card > 0) parts.push(`💳 Tarjeta: <strong>${sp.card.toFixed(2)}€</strong>`);
    if (sp.transfer > 0) parts.push(`🏦 Transf: <strong>${sp.transfer.toFixed(2)}€</strong>`);
    if (sp.bizum > 0) parts.push(`📲 Bizum: <strong>${sp.bizum.toFixed(2)}€</strong>`);

    return `
      <div class="settlement-card settled-item" style="padding:8px 10px;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
          <div>
            <span style="font-size:0.75rem; color:#94a3b8;">⏰ ${order.slot}h &bull; 👤 <strong>${order.clientName}</strong></span>
            <div style="font-size:0.82rem; font-weight:800; color:#f8fafc; margin-top:2px;">${dishesText}</div>
            <div style="font-size:0.76rem; color:#34d399; margin-top:2px;">
              ${parts.join(" &nbsp;+&nbsp; ") || "0.00€"}
            </div>
          </div>
          <div style="text-align:right; display:flex; align-items:center; gap:8px;">
            <strong style="font-size:0.95rem; color:#34d399;">${Number(order.total || 0).toFixed(2)} €</strong>
            <button type="button" class="btn-mini" onclick="toggleOrderSettledOk('${order.id}', false)" title="Devolver este pedido a pendientes">
              ↩️
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // Selector rápido de repartidor también desde la tabla de cierre por si no estaba asignado
  const riderSelectOptions = kdsState.riders
    .map((r) => `<option value="${r.id}" ${order.riderId === r.id ? "selected" : ""}>🛵 ${r.name}</option>`)
    .join("");

  return `
    <div class="settlement-card">
      <div class="settlement-card-top">
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <select class="form-select" style="width:auto; padding:4px 8px; font-size:0.78rem; font-weight:800; color:#38bdf8; background:#090d16;" onfocus="lastFormInteractionTs = Date.now()" onchange="assignRiderToOrder('${order.id}', this.value)">
            <option value="" ${!order.riderId ? "selected" : ""}>${order.type === "pickup" ? "🏢 Recogida en Tienda" : "⚠️ Asignar Repartidor..."}</option>
            ${riderSelectOptions}
          </select>
          <span style="font-size:0.78rem; color:#cbd5e1; font-weight:700;">⏰ ${order.slot}h &bull; 👤 ${order.clientName}</span>
        </div>

        <div style="display:flex; align-items:center; gap:6px;">
          <span style="font-size:0.75rem; color:#94a3b8;">Total Pedido:</span>
          <input type="number" step="0.01" class="form-input" style="width:88px; padding:4px 8px; font-weight:900; color:#fbbf24; text-align:right;" value="${Number(order.total || 0).toFixed(2)}" onfocus="lastFormInteractionTs = Date.now()" oninput="updateOrderTotalFromSettlement('${order.id}', this.value)">
          <span style="font-weight:800; color:#fbbf24;">€</span>
        </div>
      </div>

      <div style="font-size:0.83rem; font-weight:800; color:#f8fafc; margin:6px 0;">
        🥘 ${dishesText} <span style="font-weight:400; color:#94a3b8; font-size:0.75rem;">(${order.address})</span>
      </div>

      <!-- Botones rápidos de 1 clic para pago íntegro -->
      <div class="quick-pay-buttons">
        <span style="font-size:0.72rem; color:#94a3b8; font-weight:700;">Pago 100%:</span>
        <button type="button" class="btn-pay-quick ${sp.cash === order.total && order.total > 0 ? 'active' : ''}" onclick="setOrderFullPaymentMethod('${order.id}', 'cash')">💵 Todo Efectivo</button>
        <button type="button" class="btn-pay-quick ${sp.card === order.total && order.total > 0 ? 'active' : ''}" onclick="setOrderFullPaymentMethod('${order.id}', 'card')">💳 Todo Tarjeta</button>
        <button type="button" class="btn-pay-quick ${sp.transfer === order.total && order.total > 0 ? 'active' : ''}" onclick="setOrderFullPaymentMethod('${order.id}', 'transfer')">🏦 Todo Transf.</button>
        <button type="button" class="btn-pay-quick ${sp.bizum === order.total && order.total > 0 ? 'active' : ''}" onclick="setOrderFullPaymentMethod('${order.id}', 'bizum')">📲 Todo Bizum</button>
      </div>

      <!-- Casillas editables para Pago Mixto / Dividido (ej. 100€ efectivo + 15€ tarjeta) -->
      <div class="split-inputs-grid">
        <div>
          <label>💵 Efectivo (€)</label>
          <input type="number" step="0.01" class="form-input" value="${sp.cash}" onfocus="lastFormInteractionTs = Date.now()" oninput="onOrderSplitInputChange('${order.id}', 'cash', this.value)">
        </div>
        <div>
          <label>💳 Tarjeta (€)</label>
          <input type="number" step="0.01" class="form-input" value="${sp.card}" onfocus="lastFormInteractionTs = Date.now()" oninput="onOrderSplitInputChange('${order.id}', 'card', this.value)">
        </div>
        <div>
          <label>🏦 Transf. (€)</label>
          <input type="number" step="0.01" class="form-input" value="${sp.transfer}" onfocus="lastFormInteractionTs = Date.now()" oninput="onOrderSplitInputChange('${order.id}', 'transfer', this.value)">
        </div>
        <div>
          <label>📲 Bizum (€)</label>
          <input type="number" step="0.01" class="form-input" value="${sp.bizum}" onfocus="lastFormInteractionTs = Date.now()" oninput="onOrderSplitInputChange('${order.id}', 'bizum', this.value)">
        </div>
      </div>

      <div class="settlement-card-footer">
        <div id="split-diff-${order.id}" style="font-size:0.75rem; display:flex; align-items:center; gap:6px; flex-wrap:wrap;"></div>

        <button type="button" class="btn-settle-ok" style="padding:5px 10px; font-size:0.74rem;" onclick="toggleOrderSettledOk('${order.id}', true)">
          ✅ OK Pedido Individual ➔
        </button>
      </div>
    </div>
  `;
}

// ============================================================================
// ELIMINAR Y CAMBIAR ESTADOS DE PEDIDOS
// ============================================================================
function deleteOrderFromBoard(orderId) {
  const order = kdsState.orders.find((o) => o.id === orderId);
  if (!order) return;

  if (!confirm(`🗑️ ¿Seguro que quieres eliminar el pedido de "${order.clientName}" (${order.slot}h)?`)) return;

  kdsState.orders = kdsState.orders.filter((o) => o.id !== orderId);
  saveKdsOrders();
  renderAllKds();
}

function clearDeliveredOrders() {
  const deliveredCount = kdsState.orders.filter((o) => o.status === "delivered").length;
  if (deliveredCount === 0) {
    alert("No hay pedidos marcados como 'Completados' para limpiar.");
    return;
  }
  if (!confirm(`🧹 ¿Quieres borrar del tablón los ${deliveredCount} pedidos que ya están completados?`)) return;

  kdsState.orders = kdsState.orders.filter((o) => o.status !== "delivered");
  saveKdsOrders();
  renderAllKds();
}

function assignRiderToOrder(orderId, riderId) {
  lastFormInteractionTs = 0; // Permitir re-render inmediato tras seleccionar
  const order = kdsState.orders.find((o) => o.id === orderId);
  if (!order) return;

  order.riderId = riderId;
  if (riderId) {
    const r = kdsState.riders.find((x) => x.id === riderId);
    if (r) {
      order.vehicle = r.vehicle === "car" ? "car" : "bike";
      if (order.vehicle === "bike") {
        order.outboundMinutes = Math.min(15, Math.max(5, order.outboundMinutes || 12));
        order.returnMinutes = Math.min(12, Math.max(5, order.returnMinutes || 10));
      }
    }
  }

  saveKdsOrders();
  renderAllKds();
}

function dispatchOrderNow(orderId) {
  const order = kdsState.orders.find((o) => o.id === orderId);
  if (!order) return;

  if (order.type !== "pickup" && !order.riderId) {
    alert("⚠️ Selecciona primero qué repartidor se lleva este pedido.");
    return;
  }

  order.status = "en_route";
  order.departedAt = Date.now();
  order.deliveredToClientAt = null;
  order.returnedToStoreAt = null;

  saveKdsOrders();
  renderAllKds();
}

function markOrderDeliveredByClient(orderId, defaultProof = "Entregado al cliente") {
  const order = kdsState.orders.find((o) => o.id === orderId);
  if (!order) return;

  order.status = "returning";
  if (!order.departedAt) order.departedAt = Date.now() - (order.outboundMinutes || 25) * 60000;
  order.deliveredToClientAt = Date.now();
  order.deliveryProof = defaultProof;

  saveKdsOrders();
  renderAllKds();
}

function markRiderReturnedToBase(orderId) {
  const order = kdsState.orders.find((o) => o.id === orderId);
  if (!order) return;

  order.status = "delivered";
  order.returnedToStoreAt = Date.now();

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

  if (order.status === "pending") order.status = "cooking";
  else if (order.status === "cooking") order.status = "ready";
  else if (order.status === "ready") {
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
// GESTIÓN Y EDICIÓN COMPACTA DE LA PLANTILLA DE REPARTIDORES (PARA 20+ REPARTIDORES)
// ============================================================================
let editingRiderModalId = null;

function openRidersModal() {
  editingRiderModalId = null;
  const modal = document.getElementById("riders-manage-modal");
  renderRidersModalList();
  modal.classList.add("active");
}

function openEditSingleRider(riderId) {
  editingRiderModalId = riderId;
  const modal = document.getElementById("riders-manage-modal");
  renderRidersModalList();
  modal.classList.add("active");
  setTimeout(() => {
    const nameInput = document.getElementById(`edit-rider-name-${riderId}`);
    if (nameInput) {
      nameInput.focus();
      nameInput.select();
    }
  }, 60);
}

function toggleEditRiderInModal(riderId) {
  if (editingRiderModalId === riderId) {
    editingRiderModalId = null;
  } else {
    editingRiderModalId = riderId;
  }
  renderRidersModalList();
  if (editingRiderModalId) {
    setTimeout(() => {
      const nameInput = document.getElementById(`edit-rider-name-${riderId}`);
      if (nameInput) nameInput.focus();
    }, 50);
  }
}

function closeRidersModal() {
  editingRiderModalId = null;
  document.getElementById("riders-manage-modal").classList.remove("active");
}

function buildRiderWaLink(rider) {
  const mobileLink = `${PUBLIC_TUNNEL_BASE}/repartidor.html?rider=${rider.id}`;
  const cleanPhone = String(rider.phone || "").replace(/[^0-9]/g, "");
  const fullPhone = cleanPhone.length === 9 ? `34${cleanPhone}` : cleanPhone;
  return `https://wa.me/${fullPhone}?text=${encodeURIComponent(
    `Hola ${rider.name}, entra aquí desde tu móvil para abrir tu App de Repartidor de Socarratt:\n👉 ${mobileLink}`
  )}`;
}

function renderRidersModalList() {
  const listEl = document.getElementById("riders-modal-list");
  if (!listEl) return;

  if (kdsState.riders.length === 0) {
    listEl.innerHTML = `<div style="font-size:0.8rem; color:#94a3b8; padding:10px; text-align:center;">No hay repartidores registrados. Añade uno abajo.</div>`;
    return;
  }

  listEl.innerHTML = kdsState.riders
    .map((r) => {
      const vEmoji = r.vehicle === "bike" ? "🚲 Bici" : r.vehicle === "moto" ? "🛵 Moto" : "🚗 Coche";
      const waLink = buildRiderWaLink(r);
      const isEditing = editingRiderModalId === r.id;
      const safeName = String(r.name || "").replace(/"/g, "&quot;");
      const safePhone = String(r.phone || "").replace(/"/g, "&quot;");

      if (!isEditing) {
        return `
          <div style="display:flex; justify-content:space-between; align-items:center; background:#0f172a; padding:6px 10px; border-radius:8px; border:1px solid #334155; gap:8px; flex-wrap:wrap;">
            <div style="display:flex; align-items:center; gap:8px; min-width:0;">
              <strong style="font-size:0.85rem; color:#f8fafc;">${r.name}</strong>
              <span style="font-size:0.74rem; color:#94a3b8;">${vEmoji} &bull; 📞 ${r.phone}</span>
            </div>
            <div style="display:flex; gap:5px; align-items:center;">
              <button type="button" class="btn-mini btn-mini-cyan" style="padding:3px 8px;" onclick="toggleEditRiderInModal('${r.id}')">✏️ Editar</button>
              <a href="${waLink}" target="_blank" class="btn-mini btn-mini-green" style="padding:3px 8px;">📲 WhatsApp</a>
              <button type="button" class="btn-mini btn-mini-danger" style="padding:3px 7px;" onclick="deleteRider('${r.id}')" title="Eliminar repartidor">🗑️</button>
            </div>
          </div>
        `;
      }

      return `
        <div style="background:#0f172a; padding:10px; border-radius:10px; border:1.5px solid #38bdf8; display:flex; flex-direction:column; gap:8px;">
          <div class="form-row-3col" style="gap:6px;">
            <div>
              <label class="form-label" style="font-size:0.68rem; color:#94a3b8;">Nombre</label>
              <input type="text" id="edit-rider-name-${r.id}" class="form-input" style="padding:5px 8px; font-size:0.82rem; font-weight:700;" value="${safeName}" onfocus="lastFormInteractionTs = Date.now()">
            </div>
            <div>
              <label class="form-label" style="font-size:0.68rem; color:#94a3b8;">Vehículo</label>
              <select id="edit-rider-vehicle-${r.id}" class="form-select" style="padding:5px 8px; font-size:0.82rem;" onfocus="lastFormInteractionTs = Date.now()">
                <option value="bike" ${r.vehicle === "bike" ? "selected" : ""}>🚲 Bici de Carga</option>
                <option value="car" ${r.vehicle === "car" ? "selected" : ""}>🚗 Coche</option>
                <option value="moto" ${r.vehicle === "moto" ? "selected" : ""}>🛵 Moto</option>
              </select>
            </div>
            <div>
              <label class="form-label" style="font-size:0.68rem; color:#94a3b8;">Teléfono WhatsApp</label>
              <input type="tel" id="edit-rider-phone-${r.id}" class="form-input" style="padding:5px 8px; font-size:0.82rem;" value="${safePhone}" onfocus="lastFormInteractionTs = Date.now()">
            </div>
          </div>
          <div style="display:flex; justify-content:flex-end; gap:6px;">
            <button type="button" class="btn-mini btn-mini-green" onclick="saveEditedRider('${r.id}')">💾 Guardar</button>
            <button type="button" class="btn-mini" onclick="toggleEditRiderInModal('${r.id}')">✕ Cerrar</button>
          </div>
        </div>
      `;
    })
    .join("");
}

function saveEditedRider(riderId) {
  lastFormInteractionTs = 0;
  const rider = kdsState.riders.find((r) => r.id === riderId);
  if (!rider) return;

  const nameEl = document.getElementById(`edit-rider-name-${riderId}`);
  const vehEl = document.getElementById(`edit-rider-vehicle-${riderId}`);
  const phoneEl = document.getElementById(`edit-rider-phone-${riderId}`);

  if (nameEl && nameEl.value.trim()) rider.name = nameEl.value.trim();
  if (vehEl && vehEl.value) rider.vehicle = vehEl.value;
  if (phoneEl && phoneEl.value.trim()) rider.phone = phoneEl.value.trim();

  editingRiderModalId = null;
  saveKdsRiders();
  renderRidersModalList();
  renderAllKds();
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
  const rider = kdsState.riders.find((r) => r.id === riderId);
  if (rider && !confirm(`🗑️ ¿Seguro que quieres eliminar al repartidor "${rider.name}"?`)) return;
  kdsState.riders = kdsState.riders.filter((r) => r.id !== riderId);
  saveKdsRiders();
  renderRidersModalList();
  renderAllKds();
}

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
    if (e.key === "socarratt_orders" || e.key === "socarratt_riders" || e.key === "socarratt_cash_adjustments") {
      if (!isUserInteractingWithForm()) {
        loadKdsData();
        renderAllKds();
      }
    }
  });

  if (liveChannel) {
    liveChannel.onmessage = (ev) => {
      if (ev.data && ev.data.type === "RIDER_PATCH") {
        applyMobileRiderPatch(ev.data.payload);
      } else if (!isUserInteractingWithForm()) {
        loadKdsData();
        renderAllKds();
      }
    };
  }
}
