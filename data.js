/**
 * CARTA OFICIAL DE ARROCES Y PLATOS DE SOCARRATT VALENCIAN FOOD
 * Obtenido de https://socarratt.com/carta/
 */
const MENU_DATA = [
  // --- ARROCES Y PAELLAS VALENCIANAS ---
  {
    id: "paella-valenciana",
    name: "Paella Valenciana Tradicional",
    category: "paellas",
    badge: "Imprescindible",
    description: "Pollo de corral, conejo, bajoqueta (judía verde), garrofó valenciano, tomate natural rallado, romero silvestre fresco y azafrán en hebra.",
    image: "https://socarratt.com/wp-content/uploads/2025/07/personaje_arroz-al-horno-550x1024.png",
    fallbackImage: "https://images.unsplash.com/photo-1534080564583-6be75777b70a?auto=format&fit=crop&w=800&q=80",
    options: {
      socarrat: ["Socarrat tostado (Recomendado)", "Punto estándar", "Sin tostar"],
      version: ["Versión tradicional Valencia", "Versión Castellón"]
    }
  },
  {
    id: "paella-abuela",
    name: "Paella de la Abuela",
    category: "paellas",
    badge: "Receta Familiar",
    description: "Receta clásica familiar de Rafa y Jordi con carne de primera selección, verduras de la huerta y el sofrito lento tradicional de la abuela.",
    image: "https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=800&q=80",
    options: {
      socarrat: ["Socarrat tostado", "Punto estándar"]
    }
  },
  {
    id: "paella-rustica",
    name: "Paella Rústica",
    category: "paellas",
    badge: "Sabor Intenso",
    description: "Costilla de cerdo dorada, secreto ibérico y selección de setas de temporada con fondo oscuro bien reducido.",
    image: "https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=800&q=80",
    options: {
      socarrat: ["Socarrat tostado", "Punto estándar"]
    }
  },
  {
    id: "paella-carmelita",
    name: "Paella Carmelita",
    category: "paellas",
    badge: "Especialidad",
    description: "Pollo de corral, magro de cerdo seleccionado, judía verde plana y verduras de huerta en sofrito artesano.",
    image: "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?auto=format&fit=crop&w=800&q=80",
    options: {
      socarrat: ["Socarrat tostado", "Punto estándar"]
    }
  },
  {
    id: "paella-verduras",
    name: "Paella de Verduras",
    category: "paellas",
    badge: "100% Huerta",
    description: "Alcachofa fresca, pimiento rojo asado, habas tiernas, champiñones, coliflor y garrofó valenciano.",
    image: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=800&q=80",
    options: {
      socarrat: ["Socarrat tostado", "Punto estándar"]
    }
  },
  {
    id: "arroz-al-horno",
    name: "Arroz al Horno (Arròs al Forn)",
    category: "paellas",
    badge: "Típico Valenciano",
    description: "Costilla de cerdo, panceta crujiente, morcilla valenciana oreada, patata, garbanzos, ajo, tomate y caldo concentrado de cocido.",
    image: "https://socarratt.com/wp-content/uploads/2025/07/personaje_arroz-al-horno-550x1024.png",
    fallbackImage: "https://images.unsplash.com/photo-1589301760014-d929f3979dbc?auto=format&fit=crop&w=800&q=80",
    options: {
      socarrat: ["Punto tradicional al horno"]
    }
  },
  {
    id: "arroz-a-banda",
    name: "Arroz a Banda",
    category: "paellas",
    badge: "Tradición Marinera",
    description: "Simplicidad exquisita. Fumet de pescado de roca concentrado que conecta con la tradición marinera del levante español. Incluye tarrina de alioli.",
    image: "https://socarratt.com/wp-content/uploads/2025/07/personaje_arroz-a-banda-479x1024.png",
    fallbackImage: "https://images.unsplash.com/photo-1515443961218-a51367888e4b?auto=format&fit=crop&w=800&q=80",
    options: {
      socarrat: ["Socarrat tostado (Recomendado)", "Punto estándar"]
    }
  },
  {
    id: "arroz-negro",
    name: "Arroz Negro con Sepia",
    category: "paellas",
    badge: "Con Alioli Casero",
    description: "Elaborado en tinta natural de calamar con sepia fresca troceada, ajitos tiernos y servido con tarrina de alioli artesanal.",
    image: "https://socarratt.com/wp-content/uploads/2025/07/personaje_arroz-negro-436x1024.png",
    fallbackImage: "https://images.unsplash.com/photo-1630409346824-4f0e7b079088?auto=format&fit=crop&w=800&q=80",
    options: {
      socarrat: ["Socarrat tostado", "Punto estándar"]
    }
  },
  {
    id: "arroz-senoret",
    name: "Arroz al Senyoret",
    category: "paellas",
    badge: "Todo Pelado",
    description: "Para disfrutar sin mancharse las manos: todo el marisco limpio y pelado con gambitas, dados de sepia y cola de rape.",
    image: "https://socarratt.com/wp-content/uploads/2025/07/personaje_arroz-senoret-434x1024.png",
    fallbackImage: "https://images.unsplash.com/photo-1623961990059-28356e226a77?auto=format&fit=crop&w=800&q=80",
    options: {
      socarrat: ["Socarrat tostado (Recomendado)", "Punto estándar"]
    }
  },
  {
    id: "a-banda-gambon",
    name: "A Banda con Gambón",
    category: "paellas",
    badge: "Fusión Marinera",
    description: "Arroz a banda marinero enriquecido con gambones pelados frescos. La fusión perfecta entre tradición y lo esencial.",
    image: "https://socarratt.com/wp-content/uploads/2025/07/personaje_arroz-con-gambon-466x1024.png",
    fallbackImage: "https://images.unsplash.com/photo-1565557623262-b51c2513a641?auto=format&fit=crop&w=800&q=80",
    options: {
      socarrat: ["Socarrat tostado", "Punto estándar"]
    }
  },
  {
    id: "arroz-turia",
    name: "Arroz del Turia",
    category: "paellas",
    badge: "Especialidad",
    description: "Una creación exclusiva de la casa con el toque inconfundible de los hermanos Rafa y Jordi.",
    image: "https://images.unsplash.com/photo-1541832676-9b763b0239ab?auto=format&fit=crop&w=800&q=80",
    options: {
      socarrat: ["Socarrat tostado", "Punto estándar"]
    }
  },
  {
    id: "fideua-tradicional",
    name: "Fideuà Tradicional de Gandía",
    category: "paellas",
    badge: "Fideo Nº 2",
    description: "Fideos finos tostados y levantados con caldo concentrado de pescado de roca, rape, sepia y gambas.",
    image: "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?auto=format&fit=crop&w=800&q=80",
    options: {
      socarrat: ["Fideo tostado levantado", "Punto normal"],
      version: ["Versión tradicional", "Versión Fideuà Negra con tinta"]
    }
  },

  // --- ENTRANTES Y COMPLEMENTOS ---
  {
    id: "alioli-socarratt",
    name: "Tarrina Grande de Alioli Casero",
    category: "entrantes",
    price: 1.50,
    badge: "Artesanal",
    description: "El alioli insignia de Socarratt: ajo suave y aceite emulsionado a mano a la perfección.",
    image: "https://images.unsplash.com/photo-1472476443507-c7a5948772fc?auto=format&fit=crop&w=800&q=80"
  },
  {
    id: "pan-artesano",
    name: "Pan Rústico Artesanal",
    category: "entrantes",
    price: 1.80,
    badge: "Masa Madre",
    description: "Hogaza artesanal de corteza crujiente, el acompañamiento indispensable para cualquier arroz.",
    image: "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=800&q=80"
  },
  {
    id: "croquetas-socarratt",
    name: "Ración de Croquetas Caseras (6 uds)",
    category: "entrantes",
    price: 8.50,
    badge: "Cremosas",
    description: "Cremosa bechamel tradicional y crujiente rebozado dorado al punto.",
    image: "https://images.unsplash.com/photo-1562967914-608f82629710?auto=format&fit=crop&w=800&q=80"
  },

  // --- BEBIDAS ---
  {
    id: "vino-blanco",
    name: "Vino Blanco D.O. Rueda (Verdejo)",
    category: "bebidas",
    price: 9.50,
    badge: "Botella 75cl",
    description: "Afrutado, seco y muy fresco. El maridaje perfecto para los arroces de pescado y fideuàs.",
    image: "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?auto=format&fit=crop&w=800&q=80"
  },
  {
    id: "vino-tinto",
    name: "Vino Tinto D.O. Rioja Crianza",
    category: "bebidas",
    price: 11.00,
    badge: "Botella 75cl",
    description: "Equilibrado con crianza en roble, ideal para la Paella Valenciana, Rústica o Carmelita.",
    image: "https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?auto=format&fit=crop&w=800&q=80"
  },
  {
    id: "cerveza-turia",
    name: "Cerveza Turia Tostada (Pack 2 tercios)",
    category: "bebidas",
    price: 4.50,
    badge: "Pack 2x33cl",
    description: "La auténtica cerveza tostada valenciana para acompañar el arroz.",
    image: "https://images.unsplash.com/photo-1608270586620-248524c67de9?auto=format&fit=crop&w=800&q=80"
  },
  {
    id: "refresco-lata",
    name: "Refresco a elegir (Lata 33cl)",
    category: "bebidas",
    price: 2.00,
    badge: "Bien frío",
    description: "Coca-Cola (Normal / Zero), Fanta Naranja, Fanta Limón, Aquarius o Nestea.",
    image: "https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&w=800&q=80"
  },

  // --- POSTRES CASEROS ---
  {
    id: "tarta-queso",
    name: "Tarta de Queso Fluida al Horno",
    category: "postres",
    price: 5.00,
    badge: "Casera",
    description: "Cremosa en el centro con suave horneado y base crujiente de galleta.",
    image: "https://images.unsplash.com/photo-1533134242443-d4fd215305ad?auto=format&fit=crop&w=800&q=80"
  }
];
