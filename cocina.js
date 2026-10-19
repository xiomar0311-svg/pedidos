/**
 * LÓGICA DEL PANEL DE COCINA Y EXPEDICIÓN - SOCARRATT
 * Obrador: Calle Manuela Malasaña, 5 (Madrid)
 */

// Franjas horarias de producción (cada media hora)
const KITCHEN_SLOTS = ["13:00", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00"];

// Códigos postales y zonas en el radio de 15 min de las 3 bicis de carga
const BIKE_ZONE_KEYWORDS = [
  "28004", "28010", "28015", "28001", "28006", "28008", "28012", "28005", "28013", "28014", "28009", "28003", "28028",
  "malasaña", "chueca", "chamberí", "bilbao", "almagro", "trafalgar", "argüelles", "moncloa", "islas filipinas",
  "cuatro caminos", "nuevos ministerios", "francisco silvela", "manuel becerra", "ibiza", "atocha", "lavapiés",
  "embajadores", "pirámides", "príncipe pío", "debod", "salamanca", "retiro", "sol", "ópera", "centro"
];

// Comandas de demostración iniciales (si no hay guardadas) para que el panel se vea vivo
const DEMO_ORDERS = [
  {
    id: "ord-101",
    clientName: "Carlos Menéndez",
    clientPhone: "622 145 890",
    slot: "13:30",
    date: "today",
    type: "delivery_whole",
    vehicle: "car",
    address: "Paseo de la Castellana 184, 6º B (Chamartín)",
    items: [
      { name: "Paella Valenciana Tradicional", format: "Paella grande para 8 personas", highlight: "🥘 Paella grande (8p)", option: "Socarrat tostado", notes: "Llevar cambio de 50€" }
    ],
    total: 145.00,
    status: "cooking" // 'pending', 'cooking', 'ready', 'delivered'
  },
  {
    id: "ord-102",
    clientName: "Laura Gómez",
    clientPhone: "610 998 342",
    slot: "13:30",
    date: "today",
    type: "delivery_portions",
    vehicle: "bike",
    address: "Calle Fuencarral 88, 3º D (Malasaña - 28004)",
    items: [
      { name: "Arroz al Senyoret", format: "3 raciones individuales", highlight: "🍽️ 3 raciones", option: "Socarrat tostado", notes: "Sin cubiertos" },
      { name: "Tarrina Extra de Alioli", format: "1 ud", highlight: "Alioli x1" }
    ],
    total: 40.50,
    status: "ready"
  },
  {
    id: "ord-103",
    clientName: "Ignacio Vega",
    clientPhone: "654 220 119",
    slot: "14:00",
    date: "today",
    type: "pickup",
    vehicle: "pickup",
    address: "Recoge en Obrador (Manuela Malasaña 5)",
    items: [
      { name: "Arroz al Horno (Arròs al Forn)", format: "Paella grande para 6 personas", highlight: "🥘 Paella grande (6p)", option: "Punto al horno", notes: "" }
    ],
    total: 115.00,
    status: "pending"
  },
  {
    id: "ord-104",
    clientName: "Marta Ruiz",
    clientPhone: "687 431 002",
    slot: "14:00",
    date: "today",
    type: "delivery_portions",
    vehicle: "bike",
    address: "Calle Santa Engracia 45, 1º Izq (Chamberí - 28010)",
    items: [
      { name: "Paella Valenciana", format: "2 raciones", highlight: "🍽️ 2 raciones", option: "Punto estándar" },
      { name: "Arroz Negro", format: "2 raciones", highlight: "🍽️ 2 raciones", option: "Con alioli" }
    ],
    total: 52.00,
    status: "pending"
  },
  {
    id: "ord-105",
    clientName: "Familia Sotomayor",
    clientPhone: "691 800 234",
    slot: "14:30",
    date: "today",
    type: "delivery_whole",
    vehicle: "car",
    address: "Calle Alcalá 212 (Ventas - 28028)",
    items: [
      { name: "Paella de Marisco Marinera", format: "Paella grande para 10 personas", highlight: "🥘 Paella grande (10p)", option: "Socarrat tostado", notes: "Tocar al timbre rápido" }
    ],
    total: 175.00,
    status: "pending"
  }
];

// Estado local del KDS (Kitchen Display System)
const kdsState = {
  orders: [],
  selectedFilterDate: "today",
};

// Cargar pedidos desde localStorage o sembrar con demo
function loadKdsOrders() {
  const saved = localStorage.getItem("socarratt_orders");
  if (saved) {
    try {
      kdsState.orders = JSON.parse(saved);
    } catch (e) {
      kdsState.orders = [...DEMO_ORDERS];
    }
  } else {
    kdsState.orders = [...DEMO_ORDERS];
    saveKdsOrders();
  }
}

function saveKdsOrders() {
  localStorage.setItem("socarratt_orders", JSON.stringify(kdsState.orders));
}

// Inicialización del panel de cocina
document.addEventListener("DOMContentLoaded", () => {
  loadKdsOrders();
  renderKdsBoard();
  setupKdsListeners();
});

// Renderizar columnas de franjas horarias y comandas
function renderKdsBoard() {
  const container = document.getElementById("kds-slots-grid");
  if (!container) return;

  // Filtrar pedidos según la fecha elegida
  const orders = kdsState.orders.filter(
    (o) => kdsState.selectedFilterDate === "all" || o.date === kdsState.selectedFilterDate
  );

  // Calcular KPIs
  let totalPaellasGrandes = 0;
  let totalRaciones = 0;
  let bicisRuta = 0;
  let cochesRuta = 0;

  orders.forEach((o) => {
    if (o.status !== "delivered") {
      if (o.vehicle === "bike") bicisRuta++;
      if (o.vehicle === "car") cochesRuta++;
      
      o.items.forEach((item) => {
        if (item.format.includes("grande")) totalPaellasGrandes++;
        else totalRaciones += parseInt(item.format) || 2;
      });
    }
  });

  document.getElementById("kpi-paellas-count").textContent = totalPaellasGrandes;
  document.getElementById("kpi-raciones-count").textContent = totalRaciones;
  document.getElementById("kpi-bicis-count").textContent = `${bicisRuta} / 3`;
  document.getElementById("kpi-coches-count").textContent = cochesRuta;

  // Renderizar cada tramo de media hora
  container.innerHTML = KITCHEN_SLOTS.map((slot) => {
    const slotOrders = orders.filter((o) => o.slot === slot);

    return `
      <div class="slot-column" data-slot="${slot}">
        <div class="slot-header">
          <div class="slot-time">
            <span>⏰ ${slot}h</span>
          </div>
          <span class="slot-badge">${slotOrders.length} ${slotOrders.length === 1 ? 'comanda' : 'comandas'}</span>
        </div>

        <div class="slot-orders-list">
          ${slotOrders.length === 0 ? `
            <div class="slot-empty">Sin paellas para las ${slot}h</div>
          ` : slotOrders.map(renderTicketCard).join("")}
        </div>
      </div>
    `;
  }).join("");
}

// Renderizar tarjeta individual de comanda
function renderTicketCard(order) {
  let vehicleBadge = "";
  let timingAlert = "";

  if (order.vehicle === "bike") {
    vehicleBadge = `<span class="logistics-pill pill-bike">🚲 Bici de Carga (15 min)</span>`;
    timingAlert = `<div class="ticket-timing-alert timing-bike">🚲 Salir a las ${order.slot}h &bull; Entrega estimada sobre y 15 / y 45</div>`;
  } else if (order.vehicle === "car") {
    vehicleBadge = `<span class="logistics-pill pill-car">🚗 Coche (Distancia)</span>`;
    timingAlert = `<div class="ticket-timing-alert timing-car">⚠️ <strong>Sacar del fuego 30 min antes</strong> para salir en coche caliente</div>`;
  } else {
    vehicleBadge = `<span class="logistics-pill pill-pickup">🏢 Recogida en Obrador</span>`;
    timingAlert = `<div class="ticket-timing-alert">📍 Recoge en Manuela Malasaña, 5 a las ${order.slot}h</div>`;
  }

  // Estado y botón de ciclo
  const statusLabels = {
    pending: { label: "⏳ Pendiente", class: "status-pending" },
    cooking: { label: "🔥 Al fuego", class: "status-cooking" },
    ready: { label: "📦 Listo / Salir", class: "status-ready" },
    delivered: { label: "✅ Entregado", class: "status-delivered" }
  };
  const currentSt = statusLabels[order.status] || statusLabels.pending;

  return `
    <div class="ticket-card" id="ticket-${order.id}">
      <div class="ticket-header">
        <span class="ticket-client">👤 ${order.clientName}</span>
        <span class="ticket-phone">📞 ${order.clientPhone}</span>
      </div>

      <div>${vehicleBadge}</div>
      ${timingAlert}

      <div style="font-size: 0.8rem; color: #94a3b8; word-break: break-word;">
        📍 ${order.address}
      </div>

      <div class="ticket-items">
        ${order.items.map(i => `
          <div class="ticket-item-row">
            • <strong class="ticket-item-highlight">${i.highlight || i.name}</strong>: ${i.name}
            ${i.option ? `<br>&nbsp;&nbsp;<em style="color:#94a3b8;">└ Punto: ${i.option}</em>` : ''}
            ${i.notes ? `<br>&nbsp;&nbsp;<em style="color:#fbbf24;">└ Nota: ${i.notes}</em>` : ''}
          </div>
        `).join("")}
      </div>

      <div class="ticket-footer">
        <span class="ticket-total">${order.total ? order.total.toFixed(2) + ' €' : ''}</span>
        <button class="ticket-status-btn ${currentSt.class}" onclick="cycleOrderStatus('${order.id}')" title="Pulsar para avanzar estado">
          ${currentSt.label}
        </button>
      </div>
    </div>
  `;
}

// Avanzar el estado de la comanda con 1 clic (Pendiente -> Al fuego -> Listo -> Entregado)
function cycleOrderStatus(orderId) {
  const order = kdsState.orders.find((o) => o.id === orderId);
  if (!order) return;

  const statusCycle = ["pending", "cooking", "ready", "delivered"];
  const nextIdx = (statusCycle.indexOf(order.status) + 1) % statusCycle.length;
  order.status = statusCycle[nextIdx];

  saveKdsOrders();
  renderKdsBoard();
}

// Clasificador inteligente de logística según la dirección en Madrid
function detectLogisticsVehicle(address, isPickup) {
  if (isPickup) return "pickup";
  const clean = address.toLowerCase();
  const isBikeZone = BIKE_ZONE_KEYWORDS.some((kw) => clean.includes(kw));
  return isBikeZone ? "bike" : "car";
}

// Listeners y controles del KDS
function setupKdsListeners() {
  // Filtro de día
  const filterDateSelect = document.getElementById("kds-date-filter");
  if (filterDateSelect) {
    filterDateSelect.addEventListener("change", (e) => {
      kdsState.selectedFilterDate = e.target.value;
      renderKdsBoard();
    });
  }

  // Botón nueva comanda por teléfono
  const btnNewManual = document.getElementById("btn-new-phone-order");
  if (btnNewManual) {
    btnNewManual.addEventListener("click", openManualOrderModal);
  }

  // Botón imprimir comandas
  const btnPrint = document.getElementById("btn-print-kds");
  if (btnPrint) {
    btnPrint.addEventListener("click", () => window.print());
  }

  // Refrescar cada 10 segundos automáticamente por si entran pedidos nuevos
  setInterval(() => {
    loadKdsOrders();
    renderKdsBoard();
  }, 10000);

  // Escucha instantánea si se hace un pedido desde otra pestaña del mismo navegador
  window.addEventListener("storage", (e) => {
    if (e.key === "socarratt_orders") {
      loadKdsOrders();
      renderKdsBoard();
    }
  });
}

// Modal para apuntar una llamada de teléfono en 10 segundos
function openManualOrderModal() {
  const modal = document.getElementById("manual-order-modal");
  modal.classList.add("active");
}

function closeManualModal() {
  const modal = document.getElementById("manual-order-modal");
  modal.classList.remove("active");
}

function saveManualPhoneOrder() {
  const name = document.getElementById("m-client-name").value.trim();
  const phone = document.getElementById("m-client-phone").value.trim();
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
  const vehicle = detectLogisticsVehicle(address, isPickup);

  const newOrder = {
    id: `ord-tel-${Date.now()}`,
    clientName: name + " (Llamada)",
    clientPhone: phone,
    slot: slot,
    date: "today",
    type: type,
    vehicle: vehicle,
    address: isPickup ? "Recoge en Obrador (Manuela Malasaña 5)" : address,
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
  saveKdsOrders();
  renderKdsBoard();
  closeManualModal();
  alert("✅ Comanda apuntada y colocada en la franja de las " + slot + "h.");
}
