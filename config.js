/**
 * CONFIGURACIÓN DE SOCARRATT VALENCIAN FOOD
 * Web: https://socarratt.com
 */
const RESTAURANT_CONFIG = {
  // Teléfono de WhatsApp por defecto configurado
  whatsappNumber: "34607169903",

  // Datos de la marca
  businessName: "Socarratt Valencian Food",
  tagline: "La auténtica paella valenciana en Madrid para llevar y a domicilio",
  website: "https://socarratt.com",

  // Tiendas físicas en Madrid para recogida
  stores: [
    { id: "malasana", name: "Socarratt Malasaña", address: "Calle Manuela Malasaña, 5 (Madrid)" },
    { id: "chueca", name: "Socarratt Chueca", address: "Calle San Marcos, 2 (Madrid)" },
    { id: "chamberi", name: "Socarratt Chamberí", address: "Calle Viriato, 14 (Madrid)" },
  ],

  // Dirección principal mostrada
  address: "Calle Manuela Malasaña 5 / San Marcos 2 / Viriato 14 (Madrid)",
  contactPhone: "+34 607 169 903",

  // --- TARIFAS EXACTAS DE SOCARRATT ---
  // 1. Paellas Grandes (paellera completa para grupos):
  wholePaella: {
    minPeople: 6,
    maxPeople: 10,
    basePrice6p: 115.00,        // 6 personas = 115€
    pricePerExtraPerson: 15.00, // Cada persona adicional (7, 8, 9, 10) = +15€
    // 6p: 115€ | 7p: 130€ | 8p: 145€ | 9p: 160€ | 10p: 175€
  },

  // 2. Raciones Individuales:
  portions: {
    pickupPrice: 10.00,         // En tienda: 10€ / ración
    pickupMin: 1,               // Desde 1 ración en tienda
    deliveryPrice: 13.00,       // A domicilio: 13€ / ración
    deliveryMin: 2,             // Mínimo 2 raciones a domicilio
  },

  // Antelación mínima recomendada
  minAdvanceMinutes: 90,

  // Franjas de recogida / entrega
  lunchHours: ["13:00", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00"],
  dinnerHours: ["20:30", "21:00", "21:30", "22:00", "22:30"],

  // Contraseña maestra para acceder al modo de ajustes y configuración
  adminPassword: "1234",

  // Estado del negocio (true = abierto con indicador verde, false = cerrado)
  isOpen: true,

  // Aviso de fianza de paellera o envases
  panDepositNotice: "🥘 Paellas grandes (6-10 personas) servidas en paellera tradicional con fianza retornable. Raciones individuales listas en envases herméticos.",
};
