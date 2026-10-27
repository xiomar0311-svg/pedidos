/**
 * LÓGICA DE LA CARTA WEB Y PEDIDOS ONLINE - SOCARRATT VALENCIAN FOOD
 * Sincronizada con https://socarratt.com/carta/ y conectada en vivo con cocina.html
 */

const state = {
  config: { ...RESTAURANT_CONFIG },
  currentCategory: "all",
  deliveryType: "delivery", // 'delivery' (a domicilio) o 'pickup' (recoger en tienda)
  selectedStoreId: "malasana",
  cart: [],
  selectedDate: "today",
  selectedTimeSlot: "14:00"
};

let webMqttClient = null;
const WEB_MQTT_PATCH_TOPIC = "socarratt/madrid/malasana5/patch_v3";
const WEB_MQTT_STATE_TOPIC = "socarratt/madrid/malasana5/state_v3";
const webLiveChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("socarratt_live_channel") : null;

function initWebMqtt() {
  if (typeof mqtt === "undefined") return;
  try {
    webMqttClient = mqtt.connect("wss://broker.emqx.io:8084/mqtt", {
      clientId: "socarratt_web_" + Math.random().toString(16).slice(2, 10),
      clean: true,
      connectTimeout: 4000,
      reconnectPeriod: 3000
    });
  } catch (e) {}
}

function loadSavedConfig() {
  const saved = localStorage.getItem("paella_restaurant_config");
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed.whatsappNumber === "34600000000" || !parsed.whatsappNumber) {
        parsed.whatsappNumber = "34607169903";
      }
      state.config = { ...state.config, ...parsed };
    } catch (e) {}
  } else {
    state.config.whatsappNumber = "34607169903";
  }
}

function isHomeDelivery() {
  return state.deliveryType === "delivery";
}

function getSelectedOrderIsoDate() {
  const getIsoOffset = (offsetDays) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  if (state.selectedDate === "tomorrow") return getIsoOffset(1);
  if (state.selectedDate === "custom") {
    const customDateInput = document.getElementById("custom-date-val");
    if (customDateInput && customDateInput.value) return customDateInput.value;
  }
  return getIsoOffset(0);
}

function getPortionUnitPrice() {
  if (isHomeDelivery()) return 13.0;
  if (typeof getOfficialRacionPickupPrice === "function") {
    return getOfficialRacionPickupPrice(state.selectedStoreId, getSelectedOrderIsoDate());
  }
  return 10.0;
}

function onPickupStoreChange(storeId) {
  state.selectedStoreId = storeId || "malasana";
  const topSel = document.getElementById("top-pickup-store-select");
  const chkSel = document.getElementById("pickup-store-select");
  if (topSel && topSel.value !== state.selectedStoreId) topSel.value = state.selectedStoreId;
  if (chkSel && chkSel.value !== state.selectedStoreId) chkSel.value = state.selectedStoreId;
  refreshCartPortionPricesAndUI();
}

function refreshCartPortionPricesAndUI() {
  const newPortionPrice = getPortionUnitPrice();
  state.cart.forEach((item) => {
    if (item.type === "portion") {
      item.unitPrice = newPortionPrice;
    }
  });
  renderProducts();
  renderCart();
  const chkModal = document.getElementById("checkout-modal");
  if (chkModal && chkModal.classList.contains("active")) {
    renderCheckoutBreakdown();
  }
}

function calcItemWholePrice(item, people) {
  const px = Math.max(6, Math.min(15, Number(people) || 6));
  if (item.prices && item.prices[px]) return item.prices[px];
  const base6 = item.basePrice6p || 115;
  const extra = item.extraPersonPrice || 15;
  return base6 + (px - 6) * extra;
}

// Comprueba si el carrito cumple el pedido mínimo (a domicilio: mínimo 2 raciones si NO hay paella entera)
function checkCartMinimumValid() {
  if (state.cart.length === 0) return false;
  if (!isHomeDelivery()) return true;

  const hasWholePaella = state.cart.some((i) => i.type === "whole_paella");
  if (hasWholePaella) return true; // Si pide una paella grande, puede añadir 1 o más raciones sueltas sin bloqueo

  const totalPortions = state.cart
    .filter((i) => i.type === "portion")
    .reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);

  return totalPortions >= 2;
}

document.addEventListener("DOMContentLoaded", () => {
  loadSavedConfig();
  initWebMqtt();
  renderCategoryTabs();
  renderProducts();
  renderCart();
  setupEventListeners();
  setupTimeSlots();
});

function setGlobalDeliveryMode(mode) {
  state.deliveryType = mode === "pickup" ? "pickup" : "delivery";

  const btnDel = document.getElementById("btn-mode-delivery");
  const btnPick = document.getElementById("btn-mode-pickup");
  if (btnDel) btnDel.classList.toggle("active", state.deliveryType === "delivery");
  if (btnPick) btnPick.classList.toggle("active", state.deliveryType === "pickup");

  const chkDel = document.getElementById("chk-mode-delivery");
  const chkPick = document.getElementById("chk-mode-pickup");
  if (chkDel) chkDel.classList.toggle("active", state.deliveryType === "delivery");
  if (chkPick) chkPick.classList.toggle("active", state.deliveryType === "pickup");

  const topStoreBar = document.getElementById("top-pickup-store-bar");
  if (topStoreBar) topStoreBar.style.display = !isHomeDelivery() ? "block" : "none";

  const addressSection = document.getElementById("checkout-address-group");
  const storeSection = document.getElementById("checkout-store-group");
  if (addressSection) addressSection.style.display = isHomeDelivery() ? "block" : "none";
  if (storeSection) storeSection.style.display = !isHomeDelivery() ? "block" : "none";

  refreshCartPortionPricesAndUI();
}

function renderCategoryTabs() {
  const categories = [
    { id: "all", label: "🥘 Toda la Carta Oficial" },
    { id: "tierra", label: "🌾 Carta de la Tierra" },
    { id: "mar", label: "🌊 Carta del Mar" }
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

function renderProducts() {
  const container = document.getElementById("products-container");
  if (!container) return;

  const portionPrice = getPortionUnitPrice();
  const modeLabel = isHomeDelivery() ? "a domicilio" : "recogida en tienda";

  const filtered =
    state.currentCategory === "all"
      ? MENU_DATA
      : MENU_DATA.filter((item) => item.category === state.currentCategory);

  container.innerHTML = filtered
    .map((item) => {
      const p6 = item.prices[6];
      const p7 = item.prices[7];
      const p8 = item.prices[8];
      const p9 = item.prices[9];
      const p10 = item.prices[10];

      return `
      <div class="product-card official-carta-card" id="card-${item.id}">
        <div class="official-card-top">
          <div class="official-character-col">
            <img src="${item.characterImage}" alt="Personaje ${item.name}" class="official-character-img" loading="lazy">
          </div>
          <div class="official-paella-col">
            <img src="${item.image}" alt="${item.name}" class="official-paella-img" loading="lazy">
            <span class="product-badge">${item.sectionTitle}</span>
          </div>
        </div>

        <div class="product-body">
          <h3 class="product-title" style="text-transform:uppercase; letter-spacing:0.02em;">${item.name}</h3>
          <p class="product-desc">${item.description}</p>

          <div class="official-meta-box">
            <div><strong>Ingredientes:</strong> ${item.ingredients}</div>
            ${item.extraVersionInfo ? `<div style="margin-top:4px; color:#b93806; font-weight:700;">✨ ${item.extraVersionInfo}</div>` : ""}
            <div style="margin-top:4px;"><strong>Incluye:</strong> ${item.includes}</div>
            ${item.allergenImage ? `<div style="margin-top:6px;"><img src="${item.allergenImage}" alt="Alérgenos" style="height:28px; object-fit:contain;"></div>` : ""}
          </div>

          <div class="official-prices-strip">
            <div style="font-weight:800; color:#b93806; margin-bottom:4px; font-size:0.78rem;">
              🥘 PRECIOS PAELLA COMPLETA:
            </div>
            <div class="prices-pills-row">
              <span><strong>6px</strong> ${p6}€</span>
              <span><strong>7px</strong> ${p7}€</span>
              <span><strong>8px</strong> ${p8}€</span>
              <span><strong>9px</strong> ${p9}€</span>
              <span><strong>10px</strong> ${p10}€</span>
            </div>
            <div style="margin-top:6px; padding-top:6px; border-top:1px dashed #fed7aa; display:flex; justify-content:space-between; align-items:center; font-size:0.8rem;">
              <span>🥡 <strong>Ración en tupper</strong> (${modeLabel}):</span>
              <strong style="color:#ea580c;">${portionPrice}€ / ración</strong>
            </div>
          </div>

          <div class="product-footer" style="gap:8px; margin-top:auto;">
            <button type="button" class="btn-add-item" style="flex:1; justify-content:center;" onclick="openOrderModal('${item.id}', 'whole')">
              🥘 Pedir Paella (${p6}€+)
            </button>
            <button type="button" class="btn-add-item" style="flex:1; justify-content:center; background:#0f172a;" onclick="openOrderModal('${item.id}', 'portion')">
              🥡 Pedir Raciones (${portionPrice}€)
            </button>
          </div>
        </div>
      </div>
    `;
    })
    .join("");
}

function openOrderModal(productId, initialFormat = "whole") {
  const item = MENU_DATA.find((p) => p.id === productId);
  if (!item) return;

  const modal = document.getElementById("add-modal");
  const modalBody = document.getElementById("add-modal-content");
  const portionPrice = getPortionUnitPrice();

  let orderFormat = initialFormat;
  let wholePeople = 6;
  const hasWholeAlready = state.cart.some((i) => i.type === "whole_paella");
  const existingPortionsCount = state.cart
    .filter((i) => i.type === "portion")
    .reduce((s, i) => s + i.quantity, 0);
  let portionQty = isHomeDelivery() && !hasWholeAlready && existingPortionsCount === 0 ? 2 : 1;
  let selectedVersionName = item.versions ? item.versions[0] : item.name;

  const renderModal = () => {
    const wholePrice = calcItemWholePrice(item, wholePeople);
    const portionsTotal = portionQty * portionPrice;
    const currentTotal = orderFormat === "whole" ? wholePrice : portionsTotal;

    modalBody.innerHTML = `
      <div style="display:flex; align-items:center; gap:12px; margin-bottom:14px;">
        <img src="${item.image}" alt="${item.name}" style="width:68px; height:68px; object-fit:contain;">
        <div>
          <h3 style="font-size: 1.25rem; font-weight: 800; color: #111827;">${item.name}</h3>
          <p style="font-size: 0.8rem; color: #6b7280;">${item.ingredients}</p>
        </div>
      </div>

      ${item.versions ? `
        <div class="form-group" style="margin-bottom:14px;">
          <label class="form-label">Elige la versión:</label>
          <select id="modal-version-select" class="form-select" style="font-weight:700;">
            ${item.versions.map((v) => `<option value="${v}" ${v === selectedVersionName ? "selected" : ""}>${v}</option>`).join("")}
          </select>
        </div>
      ` : ""}

      <div style="margin-bottom: 16px;">
        <label style="font-size: 0.84rem; font-weight: 800; color: #374151; display: block; margin-bottom: 8px;">
          ¿Qué quieres añadir a tu pedido? (Puedes añadir paellas y luego raciones en el mismo pedido)
        </label>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
          <button type="button" id="opt-format-whole" class="time-slot-pill ${orderFormat === "whole" ? "active" : ""}" style="padding: 12px 8px; font-size: 0.88rem; display: flex; flex-direction: column; align-items: center; gap: 2px;">
            <span>🥘 Paella Completa</span>
            <strong style="font-size: 0.76rem;">6 a 10 personas (${item.basePrice6p}€ - ${item.prices[10]}€)</strong>
          </button>
          <button type="button" id="opt-format-portion" class="time-slot-pill ${orderFormat === "portion" ? "active" : ""}" style="padding: 12px 8px; font-size: 0.88rem; display: flex; flex-direction: column; align-items: center; gap: 2px;">
            <span>🥡 Raciones en Tupper</span>
            <strong style="font-size: 0.76rem;">${portionPrice.toFixed(2)}€ / ración</strong>
          </button>
        </div>
      </div>

      ${orderFormat === "whole" ? `
        <div style="background: #fff8f5; border: 1.5px solid #fbd0be; border-radius: 14px; padding: 16px; text-align: center; margin-bottom: 16px;">
          <div style="font-size: 0.92rem; font-weight: 800; color: #b93806; margin-bottom: 10px;">
            Selecciona para cuántas personas (${selectedVersionName} ${wholePeople}px)
          </div>

          <div style="display:grid; grid-template-columns:repeat(5, 1fr); gap:6px; margin-bottom:12px;">
            ${[6, 7, 8, 9, 10].map((px) => `
              <button type="button" class="px-quick-btn ${wholePeople === px ? "active" : ""}" data-px="${px}" style="padding:8px 4px; border-radius:10px; border:1.5px solid ${wholePeople === px ? "#ea580c" : "#e5e7eb"}; background:${wholePeople === px ? "#ea580c" : "#fff"}; color:${wholePeople === px ? "#fff" : "#111827"}; font-weight:800; font-size:0.82rem; cursor:pointer;">
                <div>${px}px</div>
                <div style="font-size:0.72rem; opacity:0.9;">${calcItemWholePrice(item, px)}€</div>
              </button>
            `).join("")}
          </div>

          <div style="font-size: 0.95rem; font-weight: 800; color: #111827;">
            📋 Se añadirá como: <span style="color:#ea580c;">${selectedVersionName} ${wholePeople}px</span> — <strong>${wholePrice.toFixed(2)} €</strong>
          </div>
        </div>
      ` : `
        <div style="background: #fdfbf7; border: 1.5px solid #f3ece1; border-radius: 14px; padding: 16px; text-align: center; margin-bottom: 16px;">
          <div style="font-size: 0.92rem; font-weight: 800; color: #374151; margin-bottom: 4px;">
            Número de Raciones en Tupper (${portionPrice.toFixed(2)}€ / ración)
          </div>
          <p style="font-size: 0.78rem; color: #6b7280; margin-bottom: 12px;">
            ${isHomeDelivery()
              ? "A domicilio: 13€/ración (mínimo 2 raciones si pides solo raciones; desde 1 ración si la acompañas con paella)"
              : "Recogida en tienda: 10€/ración (desde 1 ración)"}
          </p>

          <div style="display: inline-flex; align-items: center; gap: 14px; background: white; padding: 6px 16px; border-radius: 9999px; border: 1.5px solid #e5e7eb;">
            <button id="btn-portion-minus" type="button" class="qty-btn" style="width: 36px; height: 36px; font-size: 1.3rem;">−</button>
            <div style="text-align: center; min-width: 90px;">
              <span style="font-size: 1.35rem; font-weight: 800; color: #111827;">${portionQty}</span>
              <span style="font-size: 0.8rem; color: #6b7280; display: block;">${portionQty === 1 ? "ración" : "raciones"}</span>
            </div>
            <button id="btn-portion-plus" type="button" class="qty-btn" style="width: 36px; height: 36px; font-size: 1.3rem;">+</button>
          </div>

          <div style="margin-top: 12px; font-size: 0.92rem; font-weight: 800; color: #111827;">
            Total raciones: <span style="color:#ea580c;">${portionsTotal.toFixed(2)} €</span>
          </div>
        </div>
      `}

      <div class="form-group">
        <label class="form-label">Nota opcional para este plato:</label>
        <input type="text" id="modal-notes-input" class="form-input" placeholder="Ej: Sin romero, alergia...">
      </div>

      <button id="btn-confirm-add-cart" type="button" class="btn-whatsapp-order" style="background: var(--primary); margin-top: 14px;">
        ➕ Añadir a mi pedido (${currentTotal.toFixed(2)} €)
      </button>
    `;

    const verSel = document.getElementById("modal-version-select");
    if (verSel) {
      verSel.onchange = () => {
        selectedVersionName = verSel.value;
        renderModal();
      };
    }

    document.getElementById("opt-format-whole").onclick = () => {
      orderFormat = "whole";
      renderModal();
    };

    document.getElementById("opt-format-portion").onclick = () => {
      orderFormat = "portion";
      renderModal();
    };

    if (orderFormat === "whole") {
      modalBody.querySelectorAll(".px-quick-btn").forEach((btn) => {
        btn.onclick = () => {
          wholePeople = Number(btn.dataset.px);
          renderModal();
        };
      });
    } else {
      document.getElementById("btn-portion-minus").onclick = () => {
        if (portionQty > 1) {
          portionQty--;
          renderModal();
        }
      };
      document.getElementById("btn-portion-plus").onclick = () => {
        portionQty++;
        renderModal();
      };
    }

    document.getElementById("btn-confirm-add-cart").onclick = () => {
      const notesInput = document.getElementById("modal-notes-input");
      const notesVal = notesInput ? notesInput.value.trim() : "";

      if (orderFormat === "whole") {
        addWholePaellaToCart(item, selectedVersionName, wholePeople, notesVal);
      } else {
        addPortionToCart(item, selectedVersionName, portionQty, notesVal);
      }
      closeModal("add-modal");
    };
  };

  renderModal();
  modal.classList.add("active");
}

function addWholePaellaToCart(product, versionName, people, notes) {
  const price = calcItemWholePrice(product, people);
  const cleanTitle = `${versionName} ${people}px`;
  state.cart.push({
    type: "whole_paella",
    id: `${product.id}-whole-${people}-${Date.now()}`,
    productId: product.id,
    name: versionName,
    shortLabel: cleanTitle,
    people: people,
    price: price,
    notes: notes
  });

  renderCart();
  showToast(`✅ Añadido: ${cleanTitle} (${price}€)`);
}

function addPortionToCart(product, versionName, portions, notes) {
  const unitPrice = getPortionUnitPrice();
  const existingIndex = state.cart.findIndex(
    (item) => item.type === "portion" && item.name === versionName && item.notes === notes
  );

  if (existingIndex > -1) {
    state.cart[existingIndex].quantity += portions;
    state.cart[existingIndex].unitPrice = unitPrice;
  } else {
    state.cart.push({
      type: "portion",
      id: `${product.id}-portion-${Date.now()}`,
      productId: product.id,
      name: versionName,
      quantity: portions,
      unitPrice: unitPrice,
      notes: notes
    });
  }

  renderCart();
  showToast(`✅ Añadido: ${portions} ${portions === 1 ? "ración" : "raciones"} de ${versionName}`);
}

function addNightServiceToCart() {
  const exists = state.cart.find((i) => i.type === "extra" && i.name === "Servicio de noche");
  if (exists) {
    showToast("ℹ️ El Servicio de noche (+20€) ya está en tu pedido");
    return;
  }
  state.cart.push({
    type: "extra",
    id: `extra-noche-${Date.now()}`,
    name: "Servicio de noche",
    quantity: 1,
    unitPrice: 20.0,
    notes: "Suplemento oficial servicio de noche"
  });
  renderCart();
  showToast("✅ Servicio de noche (+20€) añadido al pedido");
}

function renderCart() {
  const container = document.getElementById("cart-items-container");
  const countBadge = document.getElementById("cart-count-badge");
  const emptyState = document.getElementById("cart-empty");
  const summaryBox = document.getElementById("cart-summary-box");
  const modeLabelEl = document.getElementById("cart-mode-label");
  const totalEl = document.getElementById("cart-total");
  const checkoutBtn = document.getElementById("btn-open-checkout");
  const minWarnEl = document.getElementById("cart-min-warning");

  const mobileCount = document.getElementById("mobile-cart-count");
  const mobileTotal = document.getElementById("mobile-cart-total");

  const unitPortionPrice = getPortionUnitPrice();
  state.cart.forEach((item) => {
    if (item.type === "portion") item.unitPrice = unitPortionPrice;
  });

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

  if (countBadge) countBadge.textContent = `${totalCount} ${totalCount === 1 ? "artículo" : "artículos"}`;
  if (mobileCount) mobileCount.textContent = `${totalCount} ${totalCount === 1 ? "artículo" : "artículos"}`;
  if (mobileTotal) mobileTotal.textContent = `${subtotal.toFixed(2)} €`;
  if (modeLabelEl) {
    modeLabelEl.textContent = isHomeDelivery() ? "🛵 A Domicilio" : "🏢 Recoger en Tienda";
  }

  if (state.cart.length === 0) {
    if (emptyState) emptyState.style.display = "block";
    if (container) container.style.display = "none";
    if (summaryBox) summaryBox.style.display = "none";
    if (checkoutBtn) checkoutBtn.disabled = true;
    return;
  }

  if (emptyState) emptyState.style.display = "none";
  if (container) container.style.display = "block";
  if (summaryBox) summaryBox.style.display = "block";

  const isMinValid = checkCartMinimumValid();
  if (minWarnEl) {
    minWarnEl.style.display = isMinValid ? "none" : "block";
  }
  if (checkoutBtn) {
    checkoutBtn.disabled = !isMinValid;
    checkoutBtn.style.opacity = isMinValid ? "1" : "0.55";
  }

  container.innerHTML = state.cart
    .map((item, idx) => {
      if (item.type === "whole_paella") {
        return `
        <div class="cart-item">
          <div class="cart-item-info">
            <div class="cart-item-title">🥘 ${item.name} ${item.people}px</div>
            <div class="cart-item-details">
              Paella completa (${item.people} personas)
              ${item.notes ? `<br><i>• Nota: ${item.notes}</i>` : ""}
            </div>
          </div>
          <div class="cart-item-actions">
            <button class="qty-btn" onclick="removeCartItem(${idx})" title="Eliminar" style="color:#ef4444;">✕</button>
          </div>
          <div class="cart-item-price">${item.price.toFixed(2)} €</div>
        </div>
        `;
      } else {
        const itemTotal = item.quantity * item.unitPrice;
        const isPortion = item.type === "portion";
        return `
        <div class="cart-item">
          <div class="cart-item-info">
            <div class="cart-item-title">${isPortion ? `🥡 Ración ${item.name}` : `✨ ${item.name}`}</div>
            <div class="cart-item-details">
              ${item.quantity} × ${item.unitPrice.toFixed(2)}€
              ${item.notes ? `<br><i>• Nota: ${item.notes}</i>` : ""}
            </div>
          </div>
          <div class="cart-item-actions">
            <button class="qty-btn" onclick="modifyQty(${idx}, -1)">−</button>
            <span class="qty-display">${item.quantity}</span>
            <button class="qty-btn" onclick="modifyQty(${idx}, 1)">+</button>
          </div>
          <div class="cart-item-price">${itemTotal.toFixed(2)} €</div>
        </div>
        `;
      }
    })
    .join("");

  if (totalEl) totalEl.textContent = `${subtotal.toFixed(2)} €`;
}

function modifyQty(index, delta) {
  const item = state.cart[index];
  if (!item || item.type === "whole_paella") return;

  if (delta < 0 && item.quantity <= 1) {
    state.cart.splice(index, 1);
  } else {
    item.quantity += delta;
  }

  renderCart();
  const chkModal = document.getElementById("checkout-modal");
  if (chkModal && chkModal.classList.contains("active")) {
    renderCheckoutBreakdown();
  }
}

function removeCartItem(index) {
  state.cart.splice(index, 1);
  renderCart();
  const chkModal = document.getElementById("checkout-modal");
  if (chkModal && chkModal.classList.contains("active")) {
    if (state.cart.length === 0) closeModal("checkout-modal");
    else renderCheckoutBreakdown();
  }
}

function showToast(text) {
  const toast = document.createElement("div");
  toast.style.cssText = `
    position: fixed;
    bottom: 85px;
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
  setTimeout(() => toast.remove(), 2200);
}

function setupTimeSlots() {
  const container = document.getElementById("time-slots-container");
  if (!container) return;

  const allHours = ["13:00", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00", "20:30", "21:00", "21:30"];
  if (!state.selectedTimeSlot) state.selectedTimeSlot = "14:00";

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

function setupEventListeners() {
  const btnDel = document.getElementById("btn-mode-delivery");
  const btnPick = document.getElementById("btn-mode-pickup");
  if (btnDel) btnDel.addEventListener("click", () => setGlobalDeliveryMode("delivery"));
  if (btnPick) btnPick.addEventListener("click", () => setGlobalDeliveryMode("pickup"));

  const checkoutBtns = [
    document.getElementById("btn-open-checkout"),
    document.getElementById("mobile-checkout-btn")
  ];

  checkoutBtns.forEach((btn) => {
    if (btn) {
      btn.addEventListener("click", () => {
        if (state.cart.length === 0) {
          alert("Añade primero alguna paella o raciones a tu pedido.");
          return;
        }
        if (!checkCartMinimumValid()) {
          alert("Para pedidos a domicilio solo de raciones, el mínimo son 2 raciones (o puedes combinarlas con una paella).");
          return;
        }
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
      refreshCartPortionPricesAndUI();
    });
  });

  const customDateVal = document.getElementById("custom-date-val");
  if (customDateVal) {
    customDateVal.addEventListener("change", () => refreshCartPortionPricesAndUI());
  }
}

function renderCheckoutBreakdown() {
  const modalSummary = document.getElementById("checkout-summary-breakdown");
  if (!modalSummary) return;

  let total = 0;
  const itemsHtml = state.cart
    .map((i, idx) => {
      if (i.type === "whole_paella") {
        total += i.price;
        return `
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 6px; color: #111827;">
            <span>• <strong>🥘 ${i.name} ${i.people}px</strong></span>
            <div style="display:flex; align-items:center; gap:8px;">
              <strong>${i.price.toFixed(2)}€</strong>
              <button type="button" onclick="removeCartItem(${idx})" style="border:none; background:#fee2e2; color:#b91c1c; border-radius:6px; padding:2px 6px; cursor:pointer; font-weight:800;">✕</button>
            </div>
          </div>
        `;
      } else {
        const itemTotal = i.quantity * i.unitPrice;
        total += itemTotal;
        return `
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 6px; color: #111827;">
            <span>• <strong>${i.quantity}x Ración ${i.name}</strong> (${i.unitPrice}€/ud)</span>
            <div style="display:flex; align-items:center; gap:6px;">
              <button type="button" onclick="modifyQty(${idx}, -1)" style="border:1px solid #d1d5db; background:#fff; border-radius:6px; width:24px; height:24px; cursor:pointer; font-weight:800;">−</button>
              <button type="button" onclick="modifyQty(${idx}, 1)" style="border:1px solid #d1d5db; background:#fff; border-radius:6px; width:24px; height:24px; cursor:pointer; font-weight:800;">+</button>
              <strong>${itemTotal.toFixed(2)}€</strong>
            </div>
          </div>
        `;
      }
    })
    .join("");

  const modeText = isHomeDelivery() ? "🛵 Entrega a Domicilio" : "🏢 Recogida en Tienda";

  modalSummary.innerHTML = `
    <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px; margin-bottom: 14px; font-size: 0.88rem;">
      <div style="font-weight: 800; color: #111827; margin-bottom: 8px;">
        Resumen del Pedido (${modeText}):
      </div>
      ${itemsHtml}
      <div style="display:flex; justify-content:space-between; margin-top: 10px; padding-top: 10px; border-top: 2px dashed #e5e7eb; font-weight: 800; font-size: 1.15rem; color: #111827;">
        <span>Total a pagar:</span>
        <span style="color: var(--primary);">${total.toFixed(2)} €</span>
      </div>
    </div>
  `;
}

function openCheckoutModal() {
  const modal = document.getElementById("checkout-modal");
  setGlobalDeliveryMode(state.deliveryType);
  renderCheckoutBreakdown();
  modal.classList.add("active");
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove("active");
}

function handleWhatsAppSubmit() {
  if (!checkCartMinimumValid()) {
    alert("Para envío a domicilio solo de raciones el mínimo son 2 raciones.");
    return;
  }

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

  if (!phone || phone.length < 6) {
    alert("Por favor, introduce tu teléfono móvil.");
    phoneInput.focus();
    return;
  }

  if (isHomeDelivery() && (!addressStreet || !addressStreet.value.trim())) {
    alert("Por favor, escribe tu dirección completa de entrega.");
    addressStreet.focus();
    return;
  }

  let dateText = "Hoy";
  if (state.selectedDate === "tomorrow") dateText = "Mañana";
  else if (state.selectedDate === "custom" && customDateInput && customDateInput.value) {
    dateText = customDateInput.value;
  }

  let grandTotal = 0;
  let message = `🥘 *NUEVO PEDIDO - SOCARRATT VALENCIAN FOOD* 🥘\n\n`;
  message += `👤 *Cliente:* ${name}\n`;
  message += `📞 *Teléfono:* ${phone}\n`;
  message += `🗓️ *Fecha:* ${dateText}\n`;
  message += `⏰ *Hora:* ${state.selectedTimeSlot}h\n`;
  message += `🚚 *Modalidad:* ${isHomeDelivery() ? "🛵 Entrega a domicilio" : "🏢 Recogida en tienda"}\n`;

  const chosenStoreObj =
    typeof SOCARRATT_STORES !== "undefined"
      ? SOCARRATT_STORES.find((s) => s.id === (storeSelect ? storeSelect.value : state.selectedStoreId)) || SOCARRATT_STORES[0]
      : null;
  const chosenStoreLabel = chosenStoreObj
    ? `${chosenStoreObj.name} (${chosenStoreObj.address})`
    : storeSelect
    ? storeSelect.value
    : "Malasaña (Calle Manuela Malasaña, 5)";

  if (isHomeDelivery()) {
    message += `📍 *Dirección:* ${addressStreet.value.trim()}${addressCity && addressCity.value.trim() ? ", " + addressCity.value.trim() : ""}\n`;
  } else {
    message += `📍 *Tienda:* ${chosenStoreLabel}\n`;
  }

  message += `\n📋 *PEDIDO:*\n`;

  state.cart.forEach((item) => {
    if (item.type === "whole_paella") {
      grandTotal += item.price;
      message += `• *${item.name} ${item.people}px* — *${item.price.toFixed(2)}€*\n`;
      if (item.notes) message += `   └ Nota: _${item.notes}_\n`;
    } else {
      const itemTotal = item.quantity * item.unitPrice;
      grandTotal += itemTotal;
      const label = item.type === "portion" ? `${item.quantity}x Ración ${item.name}` : `${item.quantity}x ${item.name}`;
      message += `• *${label}* — *${itemTotal.toFixed(2)}€*\n`;
      if (item.notes) message += `   └ Nota: _${item.notes}_\n`;
    }
  });

  const paymentMethodSelect = document.getElementById("client-payment-method");
  const chosenPayMethod = paymentMethodSelect ? paymentMethodSelect.value : "cash";
  const payLabels = {
    cash: "💵 Efectivo",
    card: "💳 Tarjeta (Datáfono)",
    bizum: "📲 Bizum",
    transfer: "🏦 Transferencia"
  };

  message += `---------------------------------\n`;
  message += `💰 *TOTAL:* *${grandTotal.toFixed(2)}€*\n`;
  message += `💳 *Pago:* ${payLabels[chosenPayMethod] || "💵 Efectivo"}\n`;
  message += `---------------------------------\n`;

  if (notesInput && notesInput.value.trim()) {
    message += `📝 *Notas:* ${notesInput.value.trim()}\n`;
  }

  // Registrar en el Tablón de Cocina (localStorage + MQTT Cloud + API Local)
  try {
    const isPickup = !isHomeDelivery();
    const chosenStoreId = storeSelect ? storeSelect.value : state.selectedStoreId || "malasana";
    const fullAddress = isPickup
      ? `Recoge en ${chosenStoreLabel}`
      : `${addressStreet.value.trim()}${addressCity && addressCity.value.trim() ? ", " + addressCity.value.trim() : ""}`;

    const bikeKeywords = [
      "28004", "28010", "28015", "28001", "28006", "28008", "28012", "28005", "28013", "28014", "28009", "28003",
      "malasaña", "chueca", "chamberí", "bilbao", "almagro", "trafalgar", "argüelles", "moncloa", "sol", "gran vía", "retiro", "salamanca"
    ];
    const isBike = !isPickup && bikeKeywords.some((kw) => fullAddress.toLowerCase().includes(kw));
    const vehicle = isPickup ? "pickup" : isBike ? "bike" : "car";

    // Nombres limpios como pidió el usuario: ej. "Paella Valenciana 6px" o "2x Ración Arroz Negro"
    const orderItemsKds = state.cart.map((item) => {
      if (item.type === "whole_paella") {
        const cleanLabel = `${item.name} ${item.people}px`;
        return {
          name: cleanLabel,
          format: `${item.people}px`,
          highlight: cleanLabel,
          price: item.price,
          notes: item.notes || ""
        };
      } else {
        const itemTotal = item.quantity * item.unitPrice;
        const cleanLabel = item.type === "portion" ? `${item.quantity}x Ración ${item.name}` : `${item.name}`;
        return {
          name: cleanLabel,
          format: `${item.quantity} raciones`,
          highlight: cleanLabel,
          price: itemTotal,
          notes: item.notes || ""
        };
      }
    });

    const getIsoOffset = (offsetDays) => {
      const d = new Date();
      d.setDate(d.getDate() + offsetDays);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    let kdsOrderDate = getIsoOffset(0);
    if (state.selectedDate === "tomorrow") kdsOrderDate = getIsoOffset(1);
    else if (state.selectedDate === "custom" && customDateInput && customDateInput.value) {
      kdsOrderDate = customDateInput.value;
    }

    const validKitchenSlots = [
      "13:00", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00",
      "20:30", "21:00", "21:30"
    ];
    const kdsSlot = validKitchenSlots.includes(state.selectedTimeSlot) ? state.selectedTimeSlot : "14:00";

    const roundedGrandTotal = Math.round(grandTotal * 100) / 100;
    const initialPaymentSplit = {
      cash: chosenPayMethod === "cash" ? roundedGrandTotal : 0,
      card: chosenPayMethod === "card" ? roundedGrandTotal : 0,
      transfer: chosenPayMethod === "transfer" ? roundedGrandTotal : 0,
      bizum: chosenPayMethod === "bizum" ? roundedGrandTotal : 0
    };

    const newKdsOrder = {
      id: `ord-web-${Date.now()}`,
      clientName: name,
      clientPhone: phone,
      slot: kdsSlot,
      date: kdsOrderDate,
      type: isPickup ? "pickup" : "delivery_whole",
      pickupStoreId: isPickup ? chosenStoreId : "",
      vehicle: vehicle,
      riderId: "",
      address: fullAddress,
      items: orderItemsKds,
      notes: notesInput ? notesInput.value.trim() : "",
      total: roundedGrandTotal,
      paymentSplit: initialPaymentSplit,
      settled: false,
      status: "pending"
    };

    const existingOrders = JSON.parse(localStorage.getItem("socarratt_orders") || "[]");
    existingOrders.unshift(newKdsOrder);
    localStorage.setItem("socarratt_orders", JSON.stringify(existingOrders));
    localStorage.setItem("socarratt_has_custom_state", "1");

    if (webLiveChannel) webLiveChannel.postMessage({ type: "SYNC_ALL" });

    if (webMqttClient && webMqttClient.connected) {
      webMqttClient.publish(
        WEB_MQTT_PATCH_TOPIC,
        JSON.stringify({ patchId: "web_" + Date.now(), patchOrder: newKdsOrder }),
        { qos: 1 }
      );
    }

    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" || window.location.hostname.startsWith("192.168.")) {
      fetch("/api/state", {
        method: "POST",
        body: JSON.stringify({ patchOrder: newKdsOrder })
      }).catch(() => {});
    }
  } catch (err) {
    console.error("Error guardando orden en KDS:", err);
  }

  const cleanPhone = (state.config.whatsappNumber || "34607169903").replace(/[^0-9]/g, "");
  const whatsappUrl = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(message)}`;

  state.cart = [];
  renderCart();
  closeModal("checkout-modal");
  window.open(whatsappUrl, "_blank");
}
