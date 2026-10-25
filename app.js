/**
 * LÓGICA PRINCIPAL DE LA APLICACIÓN DE PEDIDOS DE PAELLAS
 * Adaptada a las reglas de negocio exactas:
 * - Paellas grandes: 6 a 10 personas (6p = 115€, +15€/persona adicional hasta 10).
 * - Raciones individuales: 10€ en tienda / 13€ a domicilio (mínimo 2 a domicilio).
 */

const state = {
  config: { ...RESTAURANT_CONFIG },
  currentCategory: "all",
  deliveryType: "pickup", // 'pickup' (tienda) o 'delivery' (domicilio)
  cart: [],
  selectedDate: "today",
  selectedTimeSlot: "",
};

// Cargar configuración guardada
function loadSavedConfig() {
  const saved = localStorage.getItem("paella_restaurant_config");
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      // Si contenía el número de prueba antiguo, forzar el 34607169903
      if (parsed.whatsappNumber === "34600000000" || !parsed.whatsappNumber) {
        parsed.whatsappNumber = "34607169903";
      }
      state.config = { ...state.config, ...parsed };
    } catch (e) {
      console.error("Error al cargar configuración:", e);
    }
  } else {
    state.config.whatsappNumber = "34607169903";
  }
}

// Calcular precio de paella grande entera (6 a 10 personas)
function calcWholePaellaPrice(people) {
  const cfg = state.config.wholePaella;
  const clamped = Math.max(cfg.minPeople, Math.min(cfg.maxPeople, people));
  return cfg.basePrice6p + (clamped - cfg.minPeople) * cfg.pricePerExtraPerson;
}

// Comprueba si la modalidad actual requiere entrega a domicilio
function isHomeDelivery() {
  return state.deliveryType === "delivery_portions" || state.deliveryType === "delivery_whole";
}

// Obtener precio y mínimo de raciones individuales según recogida o domicilio
function getPortionRules() {
  const isDelivery = isHomeDelivery();
  return {
    price: isDelivery ? state.config.portions.deliveryPrice : state.config.portions.pickupPrice,
    min: isDelivery ? state.config.portions.deliveryMin : state.config.portions.pickupMin,
    modeLabel: isDelivery ? "a domicilio" : "recogida en tienda",
  };
}

// Inicialización
document.addEventListener("DOMContentLoaded", () => {
  loadSavedConfig();
  updateUIConfig();
  renderCategoryTabs();
  renderProducts();
  renderCart();
  setupEventListeners();
  setupTimeSlots();
});

// Actualiza textos en la UI según la configuración
function updateUIConfig() {
  const portionRules = getPortionRules();
  
  document.getElementById("restaurant-name").textContent = state.config.businessName;
  document.getElementById("restaurant-tagline").textContent = state.config.tagline;
  
  // Actualizar estado abierto / cerrado
  const statusBadge = document.querySelector(".badge-status");
  if (statusBadge) {
    if (state.config.isOpen === false || state.config.isOpen === "closed") {
      statusBadge.textContent = "Cerrado por descanso";
      statusBadge.style.background = "#fef2f2";
      statusBadge.style.color = "#991b1b";
      statusBadge.style.borderColor = "#fecaca";
    } else {
      statusBadge.textContent = "Abierto para pedidos";
      statusBadge.style.background = "#ecfdf5";
      statusBadge.style.color = "#065f46";
      statusBadge.style.borderColor = "#a7f3d0";
    }
  }

  // Actualizar banner informativo
  document.getElementById("top-notice-text").innerHTML = `
    🥘 <strong>Paellas grandes (6 a 10 pers):</strong> 115€ (6p) + 15€/pers &nbsp;|&nbsp; 
    🍽️ <strong>Raciones:</strong> 10€ en tienda &bull; 13€ a domicilio (mín. 2)
  `;

  const depositNoticeEl = document.getElementById("pan-deposit-notice");
  if (depositNoticeEl) {
    depositNoticeEl.textContent = state.config.panDepositNotice;
  }
}

// Renderizar pestañas de categorías
function renderCategoryTabs() {
  const categories = [
    { id: "all", label: "✨ Toda la carta" },
    { id: "paellas", label: "🥘 Paellas y Arroces" },
    { id: "entrantes", label: "🥟 Tapas y Entrantes" },
    { id: "bebidas", label: "🍷 Bebidas y Vinos" },
    { id: "postres", label: "🍰 Postres Caseros" },
  ];

  const container = document.getElementById("categories-tabs");
  if (!container) return;

  container.innerHTML = categories
    .map(
      (cat) => `
      <button class="tab-btn ${state.currentCategory === cat.id ? "active" : ""}" data-category="${cat.id}">
        ${cat.label}
      </button>
    `
    )
    .join("");

  container.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      container.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.currentCategory = btn.dataset.category;
      renderProducts();
    });
  });
}

// Renderizar listado de productos
function renderProducts() {
  const container = document.getElementById("products-container");
  if (!container) return;

  const portionRules = getPortionRules();
  const filtered = state.currentCategory === "all"
    ? MENU_DATA
    : MENU_DATA.filter((item) => item.category === state.currentCategory);

  if (filtered.length === 0) {
    container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #6b7280;">No hay platos en esta categoría.</div>`;
    return;
  }

  container.innerHTML = filtered
    .map((item) => {
      const isPaella = item.category === "paellas";

      return `
      <div class="product-card" id="card-${item.id}">
        <div class="product-img-wrapper">
          <img src="${item.image}" alt="${item.name}" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1534080564583-6be75777b70a?auto=format&fit=crop&w=800&q=80'">
          ${item.badge ? `<span class="product-badge">${item.badge}</span>` : ""}
          ${isPaella ? `<span class="product-min-portions">Entera (6-10p) o Raciones</span>` : ""}
        </div>
        <div class="product-body">
          <h3 class="product-title">${item.name}</h3>
          <p class="product-desc">${item.description}</p>
          
          ${isPaella ? `
            <div style="background: #fff8f5; border: 1px solid #fce3d7; border-radius: 10px; padding: 10px 12px; margin-bottom: 12px; font-size: 0.82rem; line-height: 1.45;">
              <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px;">
                <span style="font-weight: 700; color: #b93806;">🥘 Paella entera (6-10p):</span>
                <strong style="color: #111827;">115€ &ndash; 175€</strong>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: baseline; color: #4b5563;">
                <span>🍽️ Ración (${portionRules.modeLabel}):</span>
                <strong style="color: #b93806;">${portionRules.price.toFixed(2)}€ ${isHomeDelivery() ? '<small style="font-weight:normal;color:#6b7280;">(mín 2)</small>' : ''}</strong>
              </div>
            </div>
          ` : ""}

          <div class="product-footer">
            <div class="product-price-box">
              ${isPaella ? `
                <span class="product-price" style="font-size: 1.15rem;">Desde ${portionRules.price.toFixed(2)} €</span>
                <span class="product-unit">por ración individual</span>
              ` : `
                <span class="product-price">${item.price.toFixed(2)} €</span>
                <span class="product-unit">unidad / ración</span>
              `}
            </div>
            
            <button class="btn-add-item" onclick="openOrderModal('${item.id}')">
              <span>+ Pedir</span>
            </button>
          </div>
        </div>
      </div>
    `;
    })
    .join("");
}

// Modal interactivo para configurar el pedido del producto
function openOrderModal(productId) {
  const item = MENU_DATA.find((p) => p.id === productId);
  if (!item) return;

  const modal = document.getElementById("add-modal");
  const modalBody = document.getElementById("add-modal-content");
  const portionRules = getPortionRules();

  if (item.category === "paellas") {
    // Seleccionar por defecto el formato según la modalidad activa
    let orderFormat = state.deliveryType === "delivery_whole" ? "whole" : (state.deliveryType === "delivery_portions" ? "portion" : "whole");
    let wholePeople = 6;
    let portionQty = portionRules.min;

    const renderPaellaModalContent = () => {
      const wholePrice = calcWholePaellaPrice(wholePeople);
      const portionsTotal = portionQty * portionRules.price;
      const currentTotal = orderFormat === "whole" ? wholePrice : portionsTotal;

      modalBody.innerHTML = `
        <div style="text-align: center; margin-bottom: 16px;">
          <h3 style="font-size: 1.3rem; font-weight: 800; color: #111827;">${item.name}</h3>
          <p style="font-size: 0.85rem; color: #6b7280; margin-top: 4px;">${item.description}</p>
        </div>

        <!-- Selector de formato: Paella Grande vs Raciones -->
        <div style="margin-bottom: 18px;">
          <label style="font-size: 0.85rem; font-weight: 800; color: #374151; display: block; margin-bottom: 8px;">
            Elige el formato de paella:
          </label>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <button type="button" id="opt-format-whole" class="time-slot-pill ${orderFormat === 'whole' ? 'active' : ''}" style="padding: 12px 8px; font-size: 0.88rem; min-height: 56px; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 2px;">
              <span>🥘 Paella Grande</span>
              <strong style="font-size: 0.75rem; opacity: 0.9;">(6 a 10 pers)</strong>
            </button>
            <button type="button" id="opt-format-portion" class="time-slot-pill ${orderFormat === 'portion' ? 'active' : ''}" style="padding: 12px 8px; font-size: 0.88rem; min-height: 56px; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 2px;">
              <span>🍽️ Raciones</span>
              <strong style="font-size: 0.75rem; opacity: 0.9;">(${portionRules.price.toFixed(2)}€/ud)</strong>
            </button>
          </div>
        </div>

        ${orderFormat === "whole" ? `
          <!-- Configuración de Paella Grande (6 a 10 personas) -->
          <div style="background: #fff8f5; border: 1.5px solid #fbd0be; border-radius: 14px; padding: 18px; text-align: center; margin-bottom: 16px;">
            <div style="font-size: 0.95rem; font-weight: 800; color: #b93806; margin-bottom: 4px;">
              Tamaño de la Paellera (Mín. 6, Máx. 10 personas)
            </div>
            <p style="font-size: 0.8rem; color: #6b7280; margin-bottom: 12px;">
              Precio base: 115€ (6 personas) + 15€ por persona adicional
            </p>

            <div style="display: inline-flex; align-items: center; gap: 14px; background: white; padding: 6px 16px; border-radius: 9999px; border: 1.5px solid #e5e7eb; box-shadow: 0 2px 6px rgba(0,0,0,0.05);">
              <button id="btn-whole-minus" type="button" class="qty-btn" style="width: 36px; height: 36px; font-size: 1.3rem;">−</button>
              <div style="text-align: center; min-width: 90px;">
                <span id="whole-people-val" style="font-size: 1.35rem; font-weight: 800; color: #111827;">${wholePeople}</span>
                <span style="font-size: 0.8rem; color: #6b7280; display: block;">personas</span>
              </div>
              <button id="btn-whole-plus" type="button" class="qty-btn" style="width: 36px; height: 36px; font-size: 1.3rem;">+</button>
            </div>

            <!-- Tabla de desglose visual rápido -->
            <div style="margin-top: 14px; font-size: 0.8rem; color: #4b5563;">
              <span style="background: white; padding: 4px 10px; border-radius: 6px; border: 1px solid #e5e7eb; font-weight: 700;">
                ${wholePeople} personas = ${wholePrice.toFixed(2)} €
              </span>
            </div>
          </div>
        ` : `
          <!-- Configuración de Raciones Individuales -->
          <div style="background: #fdfbf7; border: 1.5px solid #f3ece1; border-radius: 14px; padding: 18px; text-align: center; margin-bottom: 16px;">
            <div style="font-size: 0.95rem; font-weight: 800; color: #374151; margin-bottom: 4px;">
              Número de Raciones individuales
            </div>
            <p style="font-size: 0.8rem; color: #6b7280; margin-bottom: 12px;">
              ${state.deliveryType === 'delivery' 
                ? 'Tarifa a domicilio: 13,00 € / ración (mínimo 2 raciones)' 
                : 'Tarifa en tienda: 10,00 € / ración (desde 1 ración)'}
            </p>

            <div style="display: inline-flex; align-items: center; gap: 14px; background: white; padding: 6px 16px; border-radius: 9999px; border: 1.5px solid #e5e7eb; box-shadow: 0 2px 6px rgba(0,0,0,0.05);">
              <button id="btn-portion-minus" type="button" class="qty-btn" style="width: 36px; height: 36px; font-size: 1.3rem;">−</button>
              <div style="text-align: center; min-width: 90px;">
                <span id="portion-qty-val" style="font-size: 1.35rem; font-weight: 800; color: #111827;">${portionQty}</span>
                <span style="font-size: 0.8rem; color: #6b7280; display: block;">raciones</span>
              </div>
              <button id="btn-portion-plus" type="button" class="qty-btn" style="width: 36px; height: 36px; font-size: 1.3rem;">+</button>
            </div>

            <div style="margin-top: 14px; font-size: 0.8rem; color: #4b5563;">
              <span style="background: white; padding: 4px 10px; border-radius: 6px; border: 1px solid #e5e7eb; font-weight: 700;">
                ${portionQty} raciones × ${portionRules.price.toFixed(2)}€ = ${portionsTotal.toFixed(2)} €
              </span>
            </div>
          </div>
        `}

        ${item.options?.socarrat ? `
          <div class="form-group">
            <label class="form-label">Punto del arroz / Socarrat:</label>
            <select id="modal-socarrat-select" class="form-select">
              ${item.options.socarrat.map(opt => `<option value="${opt}">${opt}</option>`).join("")}
            </select>
          </div>
        ` : ""}

        <div class="form-group">
          <label class="form-label">Notas para cocina (opcional):</label>
          <input type="text" id="modal-notes-input" class="form-input" placeholder="Ej: Sin pimiento, punto sabroso...">
        </div>

        <button id="btn-confirm-add-cart" class="btn-whatsapp-order" style="background: var(--primary); margin-top: 18px;">
          Añadir al pedido (${currentTotal.toFixed(2)} €)
        </button>
      `;

      // Eventos del modal
      document.getElementById("opt-format-whole").onclick = () => {
        orderFormat = "whole";
        renderPaellaModalContent();
      };

      document.getElementById("opt-format-portion").onclick = () => {
        orderFormat = "portion";
        renderPaellaModalContent();
      };

      if (orderFormat === "whole") {
        document.getElementById("btn-whole-minus").onclick = () => {
          if (wholePeople > state.config.wholePaella.minPeople) {
            wholePeople--;
            renderPaellaModalContent();
          }
        };
        document.getElementById("btn-whole-plus").onclick = () => {
          if (wholePeople < state.config.wholePaella.maxPeople) {
            wholePeople++;
            renderPaellaModalContent();
          }
        };
      } else {
        document.getElementById("btn-portion-minus").onclick = () => {
          if (portionQty > portionRules.min) {
            portionQty--;
            renderPaellaModalContent();
          }
        };
        document.getElementById("btn-portion-plus").onclick = () => {
          portionQty++;
          renderPaellaModalContent();
        };
      }

      document.getElementById("btn-confirm-add-cart").onclick = () => {
        const socarratSelect = document.getElementById("modal-socarrat-select");
        const notesInput = document.getElementById("modal-notes-input");
        const socarratVal = socarratSelect ? socarratSelect.value : "";
        const notesVal = notesInput ? notesInput.value.trim() : "";

        if (orderFormat === "whole") {
          addWholePaellaToCart(item, wholePeople, socarratVal, notesVal);
        } else {
          addPortionToCart(item, portionQty, socarratVal, notesVal);
        }

        closeModal("add-modal");
      };
    };

    renderPaellaModalContent();

  } else {
    // --- MODAL PARA ENTRANTES, BEBIDAS Y POSTRES ---
    let qty = 1;

    const renderStandardModalContent = () => {
      const total = qty * item.price;
      modalBody.innerHTML = `
        <div style="text-align: center; margin-bottom: 16px;">
          <h3 style="font-size: 1.25rem; font-weight: 800; color: #111827;">${item.name}</h3>
          <p style="font-size: 0.85rem; color: #6b7280; margin-top: 4px;">${item.description}</p>
        </div>

        <div style="background: #fdfbf7; border: 1px solid #f3ece1; border-radius: 14px; padding: 18px; text-align: center; margin-bottom: 20px;">
          <label style="font-weight: 700; font-size: 0.95rem; color: #374151; display: block; margin-bottom: 10px;">
            Cantidad:
          </label>
          <div style="display: inline-flex; align-items: center; gap: 14px; background: white; padding: 6px 14px; border-radius: 9999px; border: 1.5px solid #e5e7eb;">
            <button id="modal-std-minus" type="button" class="qty-btn" style="width: 34px; height: 34px; font-size: 1.2rem;">−</button>
            <span style="font-size: 1.25rem; font-weight: 800; min-width: 36px;">${qty}</span>
            <button id="modal-std-plus" type="button" class="qty-btn" style="width: 34px; height: 34px; font-size: 1.2rem;">+</button>
          </div>
          <div style="margin-top: 12px; font-size: 1.15rem; font-weight: 800; color: var(--primary);">
            Total: <span>${total.toFixed(2)} €</span>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Notas o preferencias (opcional):</label>
          <input type="text" id="modal-std-notes" class="form-input" placeholder="Ej: Salsa aparte, bien fría...">
        </div>

        <button id="modal-std-confirm" class="btn-whatsapp-order" style="background: var(--primary); margin-top: 20px;">
          Añadir al pedido (${total.toFixed(2)} €)
        </button>
      `;

      document.getElementById("modal-std-minus").onclick = () => {
        if (qty > 1) {
          qty--;
          renderStandardModalContent();
        }
      };

      document.getElementById("modal-std-plus").onclick = () => {
        qty++;
        renderStandardModalContent();
      };

      document.getElementById("modal-std-confirm").onclick = () => {
        const notes = document.getElementById("modal-std-notes").value.trim();
        addStandardItemToCart(item, qty, notes);
        closeModal("add-modal");
      };
    };

    renderStandardModalContent();
  }

  modal.classList.add("active");
}

// Añadir Paella Grande Entera (6 a 10 personas) al carrito
function addWholePaellaToCart(product, people, option, notes) {
  const price = calcWholePaellaPrice(people);
  state.cart.push({
    type: "whole_paella",
    id: `${product.id}-whole-${people}-${Date.now()}`,
    productId: product.id,
    name: product.name,
    people: people,
    price: price,
    option: option,
    notes: notes,
  });

  renderCart();
  showToast(`✅ Paella Grande para ${people} pers. añadida`);
}

// Añadir Raciones individuales de paella al carrito
function addPortionToCart(product, portions, option, notes) {
  const portionRules = getPortionRules();
  const existingIndex = state.cart.findIndex(
    (item) => item.type === "portion" && item.productId === product.id && item.option === option && item.notes === notes
  );

  if (existingIndex > -1) {
    state.cart[existingIndex].quantity += portions;
  } else {
    state.cart.push({
      type: "portion",
      id: `${product.id}-portion-${Date.now()}`,
      productId: product.id,
      name: product.name,
      quantity: portions,
      unitPrice: portionRules.price,
      option: option,
      notes: notes,
    });
  }

  renderCart();
  showToast(`✅ ${portions} raciones de ${product.name} añadidas`);
}

// Añadir entrante/bebida/postre estándar al carrito
function addStandardItemToCart(product, qty, notes) {
  const existingIndex = state.cart.findIndex(
    (item) => item.type === "standard" && item.productId === product.id && item.notes === notes
  );

  if (existingIndex > -1) {
    state.cart[existingIndex].quantity += qty;
  } else {
    state.cart.push({
      type: "standard",
      id: `${product.id}-std-${Date.now()}`,
      productId: product.id,
      name: product.name,
      quantity: qty,
      unitPrice: product.price,
      notes: notes,
    });
  }

  renderCart();
  showToast(`✅ ${product.name} añadido`);
}

// Actualizar precios de raciones en el carrito cuando se cambia entre recogida y domicilio
function syncCartWithDeliveryType() {
  const portionRules = getPortionRules();
  state.cart.forEach((item) => {
    if (item.type === "portion") {
      item.unitPrice = portionRules.price;
      // Si cambia a domicilio y tenía menos del mínimo (2), ajustamos a 2
      if (isHomeDelivery() && item.quantity < state.config.portions.deliveryMin) {
        item.quantity = state.config.portions.deliveryMin;
      }
    }
  });
}

// Renderizar el carrito en Sidebar y Móvil
function renderCart() {
  syncCartWithDeliveryType();

  const container = document.getElementById("cart-items-container");
  const countBadge = document.getElementById("cart-count-badge");
  const emptyState = document.getElementById("cart-empty");
  const summaryBox = document.getElementById("cart-summary-box");
  const subtotalEl = document.getElementById("cart-subtotal");
  const totalEl = document.getElementById("cart-total");
  const checkoutBtn = document.getElementById("btn-open-checkout");

  const mobileCount = document.getElementById("mobile-cart-count");
  const mobileTotal = document.getElementById("mobile-cart-total");

  // Cálculo total
  let totalCount = 0;
  let subtotal = 0;

  state.cart.forEach((item) => {
    if (item.type === "whole_paella") {
      totalCount += 1;
      subtotal += item.price;
    } else {
      totalCount += item.quantity;
      subtotal += item.quantity * item.unitPrice;
    }
  });

  countBadge.textContent = `${totalCount} ${totalCount === 1 ? "artículo" : "artículos"}`;
  if (mobileCount) mobileCount.textContent = `${totalCount} ${totalCount === 1 ? "plato" : "platos"}`;
  if (mobileTotal) mobileTotal.textContent = `${subtotal.toFixed(2)} €`;

  if (state.cart.length === 0) {
    emptyState.style.display = "block";
    container.style.display = "none";
    summaryBox.style.display = "none";
    checkoutBtn.disabled = true;
    return;
  }

  emptyState.style.display = "none";
  container.style.display = "block";
  summaryBox.style.display = "block";
  checkoutBtn.disabled = false;

  container.innerHTML = state.cart
    .map((item, idx) => {
      if (item.type === "whole_paella") {
        return `
        <div class="cart-item">
          <div class="cart-item-info">
            <div class="cart-item-title">🥘 ${item.name}</div>
            <div class="cart-item-details">
              <strong>Paella grande para ${item.people} personas</strong>
              ${item.option ? `<br><i>• ${item.option}</i>` : ""}
              ${item.notes ? `<br><i>• Nota: ${item.notes}</i>` : ""}
            </div>
          </div>
          <div class="cart-item-actions">
            <button class="qty-btn" onclick="removeCartItem(${idx})" title="Eliminar paella" style="color:#ef4444;">✕</button>
          </div>
          <div class="cart-item-price">
            ${item.price.toFixed(2)} €
          </div>
        </div>
        `;
      } else {
        const itemTotal = item.quantity * item.unitPrice;
        const isPortion = item.type === "portion";
        const minQty = isPortion ? (isHomeDelivery() ? state.config.portions.deliveryMin : 1) : 1;

        return `
        <div class="cart-item">
          <div class="cart-item-info">
            <div class="cart-item-title">${isPortion ? "🍽️ " : ""}${item.name}</div>
            <div class="cart-item-details">
              ${item.quantity} ${isPortion ? "raciones" : "uds"} × ${item.unitPrice.toFixed(2)}€
              ${item.option ? `<br><i>• ${item.option}</i>` : ""}
              ${item.notes ? `<br><i>• Nota: ${item.notes}</i>` : ""}
            </div>
          </div>
          <div class="cart-item-actions">
            <button class="qty-btn" onclick="modifyQty(${idx}, -1)">−</button>
            <span class="qty-display">${item.quantity}</span>
            <button class="qty-btn" onclick="modifyQty(${idx}, 1)">+</button>
          </div>
          <div class="cart-item-price">
            ${itemTotal.toFixed(2)} €
          </div>
        </div>
        `;
      }
    })
    .join("");

  subtotalEl.textContent = `${subtotal.toFixed(2)} €`;
  totalEl.textContent = `${subtotal.toFixed(2)} €`;
}

// Modificar cantidad de raciones o entrantes
function modifyQty(index, delta) {
  const item = state.cart[index];
  if (!item || item.type === "whole_paella") return;

  const min = item.type === "portion" && isHomeDelivery()
    ? state.config.portions.deliveryMin
    : 1;

  if (delta < 0 && item.quantity <= min) {
    state.cart.splice(index, 1);
  } else {
    item.quantity += delta;
  }

}

// Eliminar un artículo del carrito
function removeCartItem(index) {
  state.cart.splice(index, 1);
  renderCart();
}

// Mensaje toast feedback
function showToast(text) {
  const toast = document.createElement("div");
  toast.style.cssText = `
    position: fixed;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    background: #111827;
    color: white;
    padding: 10px 20px;
    border-radius: 9999px;
    font-size: 0.88rem;
    font-weight: 700;
    z-index: 9999;
    box-shadow: 0 4px 14px rgba(0,0,0,0.25);
  `;
  toast.textContent = text;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

// Configurar franjas horarias
function setupTimeSlots() {
  const container = document.getElementById("time-slots-container");
  if (!container) return;

  const allHours = [...state.config.lunchHours, ...state.config.dinnerHours];
  if (!state.selectedTimeSlot && allHours.length > 0) {
    state.selectedTimeSlot = allHours[2] || allHours[0];
  }

  container.innerHTML = allHours
    .map(
      (slot) => `
      <div class="time-slot-pill ${state.selectedTimeSlot === slot ? "active" : ""}" data-time="${slot}">
        ${slot}
      </div>
    `
    )
    .join("");

  container.querySelectorAll(".time-slot-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      container.querySelectorAll(".time-slot-pill").forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      state.selectedTimeSlot = pill.dataset.time;
    });
  });
}

/// Listeners de eventos
function setupEventListeners() {
  // Selector de 3 modalidades
  const btnPickup = document.getElementById("btn-mode-pickup");
  const btnDeliveryPortions = document.getElementById("btn-mode-delivery-portions");
  const btnDeliveryWhole = document.getElementById("btn-mode-delivery-whole");

  const setDeliveryMode = (mode) => {
    state.deliveryType = mode;
    [btnPickup, btnDeliveryPortions, btnDeliveryWhole].forEach(btn => {
      if (btn) btn.classList.remove("active");
    });
    if (mode === "pickup" && btnPickup) btnPickup.classList.add("active");
    if (mode === "delivery_portions" && btnDeliveryPortions) btnDeliveryPortions.classList.add("active");
    if (mode === "delivery_whole" && btnDeliveryWhole) btnDeliveryWhole.classList.add("active");

    updateUIConfig();
    renderProducts();
    renderCart();
  };

  if (btnPickup) btnPickup.addEventListener("click", () => setDeliveryMode("pickup"));
  if (btnDeliveryPortions) btnDeliveryPortions.addEventListener("click", () => setDeliveryMode("delivery_portions"));
  if (btnDeliveryWhole) btnDeliveryWhole.addEventListener("click", () => setDeliveryMode("delivery_whole"));

  const checkoutBtns = [
    document.getElementById("btn-open-checkout"),
    document.getElementById("mobile-checkout-btn"),
  ];

  checkoutBtns.forEach((btn) => {
    if (btn) {
      btn.addEventListener("click", () => {
        if (state.cart.length === 0) return;
        openCheckoutModal();
      });
    }
  });

  const dateOptions = document.querySelectorAll(".date-option-pill");
  dateOptions.forEach((btn) => {
    btn.addEventListener("click", () => {
      dateOptions.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.selectedDate = btn.dataset.date;
      
      const customDatePicker = document.getElementById("custom-date-picker");
      if (customDatePicker) {
        customDatePicker.style.display = btn.dataset.date === "custom" ? "block" : "none";
      }
    });
  });

  const submitWhatsappBtn = document.getElementById("btn-submit-whatsapp");
  if (submitWhatsappBtn) {
    submitWhatsappBtn.addEventListener("click", handleWhatsAppSubmit);
  }

  const configBtn = document.getElementById("btn-open-config");
  if (configBtn) {
    configBtn.addEventListener("click", requestAdminAccess);

    // Si la URL tiene ?admin, mostrar el botón
    if (window.location.search.includes("admin")) {
      configBtn.style.display = "inline-flex";
    }

    // Atajo secreto: si pulsas 3 veces seguidas sobre el logo, se pide la contraseña
    let logoClicks = 0;
    const logoEl = document.querySelector(".brand-info");
    if (logoEl) {
      logoEl.addEventListener("click", () => {
        logoClicks++;
        if (logoClicks >= 3) {
          configBtn.style.display = "inline-flex";
          requestAdminAccess();
          logoClicks = 0;
        }
        setTimeout(() => { logoClicks = 0; }, 1500);
      });
    }
  }
}

/// Modal Checkout
function openCheckoutModal() {
  const modal = document.getElementById("checkout-modal");
  const modalSummary = document.getElementById("checkout-summary-breakdown");
  const addressSection = document.getElementById("checkout-address-group");
  const storeSection = document.getElementById("checkout-store-group");

  if (addressSection) {
    addressSection.style.display = isHomeDelivery() ? "block" : "none";
  }
  if (storeSection) {
    storeSection.style.display = state.deliveryType === "pickup" ? "block" : "none";
  }

  let total = 0;
  const itemsHtml = state.cart.map((i) => {
    if (i.type === "whole_paella") {
      total += i.price;
      return `
        <div style="display:flex; justify-content:space-between; margin-bottom: 5px; color: #374151;">
          <span>• <strong>🥘 ${i.name}</strong> (Paella entera ${i.people} pers.)</span>
          <span style="font-weight:800;">${i.price.toFixed(2)}€</span>
        </div>
      `;
    } else {
      const itemTotal = i.quantity * item.unitPrice;
      total += itemTotal;
      return `
        <div style="display:flex; justify-content:space-between; margin-bottom: 5px; color: #374151;">
          <span>• ${i.name} (${i.quantity} ${i.type === "portion" ? "raciones" : "uds"})</span>
          <span style="font-weight:800;">${itemTotal.toFixed(2)}€</span>
        </div>
      `;
    }
  }).join("");

  let modeSummaryText = "🏢 Recogida en tienda";
  if (state.deliveryType === "delivery_portions") modeSummaryText = "🛵 Raciones a domicilio";
  if (state.deliveryType === "delivery_whole") modeSummaryText = "🥘 Paella grande a domicilio";

  modalSummary.innerHTML = `
    <div style="background: #f9fafb; border-radius: 12px; padding: 14px; margin-bottom: 16px; font-size: 0.88rem;">
      <div style="font-weight: 800; color: #111827; margin-bottom: 8px;">
        Desglose de tu pedido (${modeSummaryText}):
      </div>
      ${itemsHtml}
      <div style="display:flex; justify-content:space-between; margin-top: 10px; padding-top: 10px; border-top: 2px dashed #e5e7eb; font-weight: 800; font-size: 1.15rem; color: #111827;">
        <span>Total:</span>
        <span style="color: var(--primary);">${total.toFixed(2)} €</span>
      </div>
    </div>
  `;

  modal.classList.add("active");
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove("active");
}

// Generar mensaje y enviar por WhatsApp
function handleWhatsAppSubmit() {
  const nameInput = document.getElementById("client-name");
  const phoneInput = document.getElementById("client-phone");
  const addressStreet = document.getElementById("client-address-street");
  const addressCity = document.getElementById("client-address-city");
  const notesInput = document.getElementById("client-notes");
  const customDateInput = document.getElementById("custom-date-val");
  const storeSelect = document.getElementById("pickup-store-select");

  const name = nameInput.value.trim();
  const phone = phoneInput.value.trim();

  if (!name) {
    alert("Por favor, introduce tu nombre.");
    nameInput.focus();
    return;
  }

  if (!phone || phone.length < 9) {
    alert("Por favor, introduce tu número de teléfono móvil.");
    phoneInput.focus();
    return;
  }

  if (isHomeDelivery() && (!addressStreet || !addressStreet.value.trim())) {
    alert("Por favor, indica tu dirección completa para la entrega a domicilio.");
    addressStreet.focus();
    return;
  }

  if (!state.selectedTimeSlot) {
    alert("Por favor, selecciona una hora para la recogida o entrega.");
    return;
  }

  let dateText = "Hoy";
  if (state.selectedDate === "tomorrow") dateText = "Mañana";
  else if (state.selectedDate === "custom" && customDateInput && customDateInput.value) {
    dateText = customDateInput.value;
  }

  let grandTotal = 0;

  // FORMATO DEL MENSAJE DE WHATSAPP
  let message = `🥘 *NUEVO PEDIDO - ${state.config.businessName.toUpperCase()}* 🥘\n\n`;
  message += `👤 *Cliente:* ${name}\n`;
  message += `📞 *Teléfono:* ${phone}\n\n`;

  message += `🗓️ *Fecha:* ${dateText}\n`;
  message += `⏰ *Hora:* ${state.selectedTimeSlot}h\n`;

  let modeLabel = "🏢 Recogida en tienda";
  if (state.deliveryType === "delivery_portions") {
    modeLabel = "🛵 Raciones a domicilio (mín. 2)";
  } else if (state.deliveryType === "delivery_whole") {
    modeLabel = "🥘 Paella grande a domicilio (6-10 personas)";
  }
  message += `🚚 *Modalidad:* ${modeLabel}\n`;

  if (isHomeDelivery()) {
    message += `📍 *Dirección de entrega:* ${addressStreet.value.trim()}`;
    if (addressCity && addressCity.value.trim()) message += `, ${addressCity.value.trim()}`;
    message += `\n`;
  } else {
    const storeText = storeSelect ? storeSelect.value : state.config.address;
    message += `📍 *Tienda de recogida:* ${storeText}\n`;
  }

  message += `\n📋 *DETALLE DEL PEDIDO:*\n`;

  state.cart.forEach((item) => {
    if (item.type === "whole_paella") {
      grandTotal += item.price;
      message += `• *🥘 ${item.name}*\n`;
      message += `   └ Formato: *Paella grande para ${item.people} personas*\n`;
      message += `   └ Precio: *${item.price.toFixed(2)}€*\n`;
      if (item.option) message += `   └ Punto: _${item.option}_\n`;
      if (item.notes) message += `   └ Nota: _${item.notes}_\n`;
    } else {
      const itemTotal = item.quantity * item.unitPrice;
      grandTotal += itemTotal;
      const unitLabel = item.type === "portion" ? "raciones individuales" : "uds";
      message += `• *${item.name}* (${item.quantity} ${unitLabel}) - *${itemTotal.toFixed(2)}€*\n`;
      if (item.option) message += `   └ Punto: _${item.option}_\n`;
      if (item.notes) message += `   └ Nota: _${item.notes}_\n`;
    }
  });

  message += `---------------------------------\n`;
  message += `💰 *TOTAL A PAGAR:* *${grandTotal.toFixed(2)}€*\n`;
  message += `---------------------------------\n`;

  if (notesInput && notesInput.value.trim()) {
    message += `📝 *Observaciones / Alergias:*\n${notesInput.value.trim()}\n\n`;
  }

  message += `💬 _Pedido generado desde la carta web. Espero confirmación, ¡muchas gracias!_`;

  // Guardar comanda automáticamente en el Panel de Cocina de Manuela Malasaña 5
  try {
    const isPickup = !isHomeDelivery();
    const fullAddress = isPickup 
      ? (storeSelect ? storeSelect.value : state.config.address)
      : `${addressStreet.value.trim()}${addressCity && addressCity.value.trim() ? ', ' + addressCity.value.trim() : ''}`;

    const bikeKeywords = [
      "28004", "28010", "28015", "28001", "28006", "28008", "28012", "28005", "28013", "28014", "28009", "28003", "28028",
      "malasaña", "chueca", "chamberí", "bilbao", "almagro", "trafalgar", "argüelles", "moncloa", "islas filipinas",
      "cuatro caminos", "nuevos ministerios", "francisco silvela", "manuel becerra", "ibiza", "atocha", "lavapiés",
      "embajadores", "pirámides", "príncipe pío", "debod", "salamanca", "retiro", "sol", "ópera", "centro"
    ];
    const isBike = !isPickup && bikeKeywords.some(kw => fullAddress.toLowerCase().includes(kw));
    const vehicle = isPickup ? "pickup" : (isBike ? "bike" : "car");

    const orderItemsKds = state.cart.map(item => ({
      name: item.name,
      format: item.type === "whole_paella" ? `Paella grande para ${item.people} personas` : `${item.quantity} raciones`,
      highlight: item.type === "whole_paella" ? `🥘 Paella grande (${item.people}p)` : `🍽️ ${item.quantity} raciones`,
      option: item.option || "",
      notes: item.notes || ""
    }));

    const getIsoOffset = (offsetDays) => {
      const d = new Date();
      d.setDate(d.getDate() + offsetDays);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    let kdsOrderDate = getIsoOffset(0);
    if (state.selectedDate === "tomorrow") {
      kdsOrderDate = getIsoOffset(1);
    } else if (state.selectedDate === "custom" && customDateInput && customDateInput.value) {
      kdsOrderDate = customDateInput.value;
    }

    const existingOrders = JSON.parse(localStorage.getItem("socarratt_orders") || "[]");
    existingOrders.unshift({
      id: `ord-web-${Date.now()}`,
      clientName: name,
      clientPhone: phone,
      slot: state.selectedTimeSlot,
      date: kdsOrderDate,
      type: state.deliveryType,
      vehicle: vehicle,
      address: fullAddress,
      items: orderItemsKds,
      total: grandTotal,
      status: "pending"
    });
    localStorage.setItem("socarratt_orders", JSON.stringify(existingOrders));
  } catch (err) {
    console.error("Error guardando orden en KDS:", err);
  }

  const cleanPhone = state.config.whatsappNumber.replace(/[^0-9]/g, "");
  const encodedText = encodeURIComponent(message);
  const whatsappUrl = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodedText}`;

  window.open(whatsappUrl, "_blank");
  closeModal("checkout-modal");
}

// Funciones de Autenticación de Administración
function requestAdminAccess() {
  const authModal = document.getElementById("auth-modal");
  const passInput = document.getElementById("auth-password-input");
  const errorMsg = document.getElementById("auth-error-msg");

  if (passInput) passInput.value = "";
  if (errorMsg) errorMsg.style.display = "none";
  if (authModal) {
    authModal.classList.add("active");
    if (passInput) setTimeout(() => passInput.focus(), 150);
  }
}

function verifyAdminPassword() {
  const passInput = document.getElementById("auth-password-input");
  const errorMsg = document.getElementById("auth-error-msg");
  const enteredPass = passInput ? passInput.value.trim() : "";
  const currentPass = state.config.adminPassword || "1234";

  if (enteredPass === currentPass) {
    closeModal("auth-modal");
    openConfigModal();
  } else {
    if (errorMsg) errorMsg.style.display = "block";
    if (passInput) {
      passInput.focus();
      passInput.select();
    }
  }
}

// Configuración rápida del dueño
function openConfigModal() {
  const modal = document.getElementById("config-modal");
  document.getElementById("cfg-phone").value = state.config.whatsappNumber;
  document.getElementById("cfg-name").value = state.config.businessName;
  document.getElementById("cfg-address").value = state.config.address;
  
  const statusSelect = document.getElementById("cfg-status");
  if (statusSelect) {
    statusSelect.value = state.config.isOpen === false ? "closed" : "open";
  }

  const passInput = document.getElementById("cfg-password");
  if (passInput) {
    passInput.value = "";
    passInput.placeholder = `Clave actual: ${state.config.adminPassword || '1234'}`;
  }

  modal.classList.add("active");
}

function saveConfigModal() {
  const phone = document.getElementById("cfg-phone").value.trim();
  const name = document.getElementById("cfg-name").value.trim();
  const address = document.getElementById("cfg-address").value.trim();
  const statusSelect = document.getElementById("cfg-status");
  const newPass = document.getElementById("cfg-password")?.value.trim();

  if (phone) state.config.whatsappNumber = phone;
  if (name) state.config.businessName = name;
  if (address) state.config.address = address;
  if (statusSelect) state.config.isOpen = statusSelect.value === "open";
  if (newPass) state.config.adminPassword = newPass;

  localStorage.setItem("paella_restaurant_config", JSON.stringify(state.config));
  updateUIConfig();
  renderProducts();
  renderCart();
  closeModal("config-modal");
  alert("✅ Configuración guardada correctamente.");
}
