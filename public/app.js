// 한끼 최저가 - 화면 동작
const $ = (sel) => document.querySelector(sel);
const fmt = (n) => Math.round(n).toLocaleString('ko-KR');
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const PAGE = 50;
const DETAIL_BATCH = 8;
const DETAIL_WORKERS = 3;

const state = {
  searchId: 0,
  center: null,
  label: '',
  radius: 300,
  provider: null,
  warnings: [],
  places: new Map(),
  group: 'all',
  shown: PAGE,
  status: null,
  map: null,
  mapLayer: null,
  progress: { done: 0, total: 0 },
};

/* ---------- 저장된 입력값 (이 브라우저에만) ---------- */
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('hankki:' + key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem('hankki:' + key, JSON.stringify(value));
    } catch {
      /* 저장 못 해도 괜찮음 */
    }
  },
};

/* ---------- API ---------- */
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* JSON 아님 */
  }
  if (!res.ok) throw new Error(data?.error || `서버 오류 (${res.status})`);
  return data;
}

/* ---------- 알림 ---------- */
function notice(message, type = 'warn') {
  const el = $('#notice');
  if (!message) {
    el.hidden = true;
    return;
  }
  el.className = 'notice' + (type === 'error' ? ' error' : '');
  el.innerHTML = message;
  el.hidden = false;
}

/* ---------- 입력값 ---------- */
function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.max(min, n));
}

function readConditions() {
  const people = clampInt($('#people').value, 1, 30, 1);
  const budgetRaw = Number(String($('#budget').value).replace(/,/g, ''));
  const budget = Number.isFinite(budgetRaw) && budgetRaw > 0 ? budgetRaw : null;
  const mode = $('#budget-mode').value;
  const perPersonBudget = budget ? (mode === 'person' ? budget : budget / people) : null;
  $('#people').value = people;
  store.set('people', people);
  store.set('budget', budget ?? '');
  store.set('budgetMode', mode);
  return { people, budget, mode, perPersonBudget };
}

function readRadius(inputId) {
  const max = state.status?.maxRadius || 2000;
  const min = state.status?.minRadius || 50;
  const r = clampInt($('#' + inputId).value, min, max, 300);
  $('#' + inputId).value = r;
  syncRadiusButtons(inputId);
  store.set(inputId, r);
  return r;
}

function syncRadiusButtons(inputId) {
  const picker = document.querySelector(`.radius-picker[data-input="${inputId}"]`);
  const value = Number($('#' + inputId).value);
  picker.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.value) === value)));
}

/* ---------- 현재 위치 ---------- */
function getPosition() {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext) {
      reject(
        new Error(
          '휴대폰에서 현재 위치를 쓰려면 https 주소(또는 localhost)로 접속해야 합니다. 아래 <b>다른 위치에서 찾기</b>에 위치를 입력해 검색할 수 있어요.',
        ),
      );
      return;
    }
    if (!navigator.geolocation) {
      reject(new Error('이 브라우저는 위치 기능을 지원하지 않습니다. 아래에 위치를 입력해 주세요.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (err) => {
        const msg =
          err.code === 1
            ? '위치 권한이 꺼져 있습니다. 브라우저 설정에서 위치 권한을 허용하거나, 아래 <b>다른 위치에서 찾기</b>에 위치를 입력해 주세요.'
            : '현재 위치를 확인하지 못했습니다. 잠시 후 다시 시도하거나 아래에 위치를 입력해 주세요.';
        reject(new Error(msg));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  });
}

/* ---------- 검색 ---------- */
function setBusy(busy) {
  $('#nearby-btn').disabled = busy;
  $('#place-btn').disabled = busy;
}

async function searchNearby(e) {
  e?.preventDefault();
  readConditions();
  const radius = readRadius('radius');
  setBusy(true);
  notice('');
  $('#nearby-btn').textContent = '📍 위치 확인 중…';
  try {
    const pos = await getPosition();
    const accuracy = pos.accuracy > 150 ? ` (위치 오차 약 ${fmt(pos.accuracy)}m)` : '';
    await runSearch({ lat: pos.lat, lng: pos.lng, radius, label: '내 위치' + accuracy });
  } catch (err) {
    notice(err.message, 'error');
  } finally {
    $('#nearby-btn').textContent = '📍 검색';
    setBusy(false);
  }
}

async function searchByPlace(e) {
  e?.preventDefault();
  const q = $('#place-query').value.trim();
  if (!q) {
    notice('찾을 위치를 입력해 주세요. 예: 강남역, 서울 중구 세종대로 110', 'error');
    $('#place-query').focus();
    return;
  }
  readConditions();
  const radius = readRadius('place-radius');
  store.set('placeQuery', q);
  setBusy(true);
  notice('');
  try {
    const { candidates, warnings } = await api('/api/geocode?q=' + encodeURIComponent(q));
    if (!candidates.length) {
      notice(`'${esc(q)}' 위치를 찾지 못했습니다. 역 이름, 건물 이름이나 도로명 주소로 다시 입력해 주세요.${warnings?.length ? '<br><small>' + esc(warnings.join(' / ')) + '</small>' : ''}`, 'error');
      $('#candidates').hidden = true;
      return;
    }
    renderCandidates(candidates, 0, radius);
    const c = candidates[0];
    await runSearch({ lat: c.lat, lng: c.lng, radius, label: c.name });
  } catch (err) {
    notice(esc(err.message), 'error');
  } finally {
    setBusy(false);
  }
}

function renderCandidates(candidates, selected, radius) {
  const box = $('#candidates');
  if (candidates.length <= 1) {
    box.hidden = true;
    return;
  }
  box.innerHTML =
    '<span class="muted">이 위치가 맞나요?</span>' +
    candidates
      .map(
        (c, i) =>
          `<button type="button" data-i="${i}" aria-pressed="${i === selected}" title="${esc(c.address)}">${esc(c.name)}<br><small class="muted">${esc(c.address)}</small></button>`,
      )
      .join('');
  box.hidden = false;
  box.onclick = (ev) => {
    const btn = ev.target.closest('button[data-i]');
    if (!btn) return;
    const i = Number(btn.dataset.i);
    renderCandidates(candidates, i, radius);
    readConditions();
    const c = candidates[i];
    runSearch({ lat: c.lat, lng: c.lng, radius: readRadius('place-radius'), label: c.name });
  };
}

async function runSearch({ lat, lng, radius, label }) {
  const id = ++state.searchId;
  state.center = { lat, lng };
  state.radius = radius;
  state.label = label;
  state.shown = PAGE;
  state.group = 'all';
  state.places = new Map();
  state.progress = { done: 0, total: 0 };

  const section = $('#results-section');
  section.hidden = false;
  $('#summary-title').textContent = `${label} 주변 ${radius >= 1000 ? radius / 1000 + 'km' : radius + 'm'}`;
  $('#summary').innerHTML = '<span class="spin"></span> 주변 식당을 모으는 중…';
  $('#results').innerHTML = '';
  $('#empty').hidden = true;
  $('#more').hidden = true;
  $('#progress').hidden = true;
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });

  let data;
  try {
    data = await api(`/api/places?lat=${lat}&lng=${lng}&radius=${radius}`);
  } catch (err) {
    if (id !== state.searchId) return;
    $('#summary').textContent = '';
    notice(esc(err.message), 'error');
    return;
  }
  if (id !== state.searchId) return;
  state.provider = data.provider;
  state.warnings = data.warnings || [];
  for (const p of data.places) putPlace(p);
  if (state.warnings.length) notice(state.warnings.map(esc).join('<br>'));
  render();
  updateMap();
  loadDetails(id);
}

/* ---------- 카카오맵 메뉴 가격 불러오기 ---------- */
const minimal = (p) => ({
  id: p.id,
  kakaoId: p.kakaoId,
  name: p.name,
  category: p.category,
  address: p.address,
  jibunAddress: p.jibunAddress,
  lat: p.lat,
  lng: p.lng,
  phone: p.phone,
  url: p.url,
  distance: p.distance,
  provider: p.provider,
});

async function loadDetails(id) {
  const pending = [...state.places.values()].filter((p) => p.detailStatus === 'pending');
  if (!pending.length) return;
  // 지금 싸 보이는 곳부터 확인해서 위쪽 순위가 먼저 정확해지게
  pending.sort((a, b) => a.price.amount - b.price.amount || a.distance - b.distance);
  const batches = [];
  for (let i = 0; i < pending.length; i += DETAIL_BATCH) batches.push(pending.slice(i, i + DETAIL_BATCH));
  state.progress = { done: 0, total: pending.length };
  updateProgress();

  let next = 0;
  const worker = async () => {
    while (next < batches.length && id === state.searchId) {
      const batch = batches[next++];
      try {
        const { results } = await api('/api/details', { method: 'POST', body: { places: batch.map(minimal) } });
        if (id !== state.searchId) return;
        for (const place of Object.values(results)) putPlace(place);
      } catch {
        for (const p of batch) state.places.set(p.id, { ...state.places.get(p.id), detailStatus: 'failed' });
      }
      state.progress.done += batch.length;
      updateProgress();
      scheduleRender();
    }
  };
  await Promise.all(Array.from({ length: DETAIL_WORKERS }, worker));
  if (id === state.searchId) {
    render();
    updateMap();
  }
}

function updateProgress() {
  const { done, total } = state.progress;
  const el = $('#progress');
  if (!total || done >= total) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.querySelector('.bar span').style.width = `${Math.round((done / total) * 100)}%`;
  el.querySelector('small').textContent = `카카오맵 메뉴판에서 실제 가격 확인 중… ${done}/${total}곳`;
}

let renderTimer = null;
function scheduleRender() {
  if (renderTimer) return;
  renderTimer = setTimeout(() => {
    renderTimer = null;
    render();
  }, 350);
}

/* ---------- 결과 그리기 ---------- */
function isClosedNow(p) {
  return Boolean(p.open?.code) && p.open.code !== 'OPEN';
}

function filtered(conditions) {
  const onlyReal = $('#only-real').checked;
  const hideClosed = $('#hide-closed').checked;
  const includeBars = $('#include-bars').checked;
  const stats = { overBudget: 0, nonMeal: 0, estimate: 0, closed: 0 };
  const list = [];
  for (const p of state.places.values()) {
    if (!includeBars && (p.group === 'bar' || p.group === 'dessert')) {
      stats.nonMeal++;
      continue;
    }
    if (onlyReal && p.price.isEstimate) {
      stats.estimate++;
      continue;
    }
    if (hideClosed && isClosedNow(p)) {
      stats.closed++;
      continue;
    }
    if (conditions.perPersonBudget && p.price.amount > conditions.perPersonBudget) {
      stats.overBudget++;
      continue;
    }
    list.push(p);
  }
  list.sort(
    (a, b) =>
      a.price.amount - b.price.amount ||
      Number(a.price.isEstimate) - Number(b.price.isEstimate) ||
      a.distance - b.distance,
  );
  return { list, stats };
}

function walkText(m) {
  const min = Math.max(1, Math.round(m / 67));
  return `${fmt(m)}m · 도보 ${min}분`;
}

function openText(p) {
  if (!p.open) return '';
  if (p.open.code === 'OPEN') return `<span class="open-yes">${esc(p.open.text || '영업 중')}</span>${p.open.info ? ' ' + esc(p.open.info) : ''}`;
  if (p.open.code) return `<span class="open-no">${esc(p.open.text || '영업 종료')}</span>${p.open.info ? ' ' + esc(p.open.info) : ''}`;
  return p.open.today ? `오늘 ${esc(p.open.today)}` : '';
}

function sourceBadge(price) {
  const date = price.updatedAt ? ` · ${esc(String(price.updatedAt).slice(0, 7).replace('-', '.'))}` : '';
  return `<span class="src src-${esc(price.source)}" title="가격 출처">${esc(price.sourceLabel)}${date}</span>`;
}

function cardHtml(p, rank, people) {
  const price = p.price;
  const total = price.amount * people;
  const est = price.isEstimate;
  const pending = p.detailStatus === 'pending';
  const menuLine = est
    ? `<span class="menu-name">${esc(price.menuName)}</span> 기준 약 ${fmt(price.amount)}원 ${sourceBadge(price)}${
        pending ? ' <span class="spin" title="메뉴판 확인 중"></span>' : ''
      }${price.note ? `<br><span class="est-note">${esc(price.note)}</span>` : ''}`
    : `<span class="menu-name">${esc(price.menuName)}</span> ${price.servings > 1 ? `${fmt(price.rawPrice)}원(${price.servings}인) → 1인 ` : ''}<b>${fmt(price.amount)}원</b> ${sourceBadge(price)}`;
  const menuCount = p.menu?.length || 0;
  const open = openText(p);
  return `<li class="result${rank <= 3 ? ' top' + rank : ''}" data-id="${esc(p.id)}">
    <div class="rank">${rank}</div>
    <div class="r-body">
      <a class="r-name" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)}</a>${p.goodprice ? '<span class="badge gp" title="행정안전부·지자체 지정 착한가격업소">착한가격업소</span>' : ''}
      <div class="r-meta">${esc(p.groupLabel)} · ${walkText(p.distance)}${open ? ' · ' + open : ''}</div>
      <div class="r-menu">${menuLine}</div>
    </div>
    <div class="r-price">
      <div class="r-total${est ? ' est' : ''}">${est ? '약 ' : ''}${fmt(total)}원</div>
      <div class="r-per">${people > 1 ? `1인 ${fmt(price.amount)}원 × ${people}명` : '1명'}</div>
    </div>
    <div class="r-actions">
      ${menuCount ? `<button type="button" data-act="menu">메뉴 ${menuCount}개</button>` : ''}
      <a href="${esc(p.url)}" target="_blank" rel="noopener">${p.provider === 'osm' ? '지도' : '카카오맵'}</a>
      ${p.phone ? `<a href="tel:${esc(p.phone.replace(/[^0-9+]/g, ''))}">전화</a>` : ''}
      <button type="button" data-act="price">${price.source === 'user' ? '내 가격 수정' : '가격 입력'}</button>
    </div>
  </li>`;
}

function render() {
  const conditions = readConditionsSilently();
  const { list: all, stats } = filtered(conditions);

  // 종류 칩
  const counts = new Map();
  for (const p of all) counts.set(p.group, { label: p.groupLabel, n: (counts.get(p.group)?.n || 0) + 1 });
  if (state.group !== 'all' && !counts.has(state.group)) state.group = 'all';
  $('#group-chips').innerHTML =
    `<button type="button" data-group="all" aria-pressed="${state.group === 'all'}">전체 ${all.length}</button>` +
    [...counts.entries()]
      .sort((a, b) => b[1].n - a[1].n)
      .map(([key, v]) => `<button type="button" data-group="${esc(key)}" aria-pressed="${state.group === key}">${esc(v.label)} ${v.n}</button>`)
      .join('');

  const list = state.group === 'all' ? all : all.filter((p) => p.group === state.group);
  const shown = list.slice(0, state.shown);
  $('#results').innerHTML = shown.map((p, i) => cardHtml(p, i + 1, conditions.people)).join('');
  $('#more').hidden = list.length <= state.shown;
  $('#more').textContent = `더 보기 (${list.length - state.shown}곳 더)`;

  const real = all.filter((p) => !p.price.isEstimate).length;
  const parts = [
    `식당 ${fmt(state.places.size)}곳 중 ${fmt(all.length)}곳`,
    `${conditions.people}명`,
    conditions.budget
      ? `예산 ${fmt(conditions.budget)}원${conditions.mode === 'person' ? '(1인당)' : `(1인 ${fmt(conditions.perPersonBudget)}원)`}`
      : '예산 제한 없음',
    `실제 가격 확인 ${fmt(real)}곳`,
  ];
  const excluded = [];
  if (stats.overBudget) excluded.push(`예산 초과 ${stats.overBudget}곳`);
  if (stats.nonMeal) excluded.push(`술집·카페 ${stats.nonMeal}곳`);
  if (stats.estimate) excluded.push(`가격 미확인 ${stats.estimate}곳`);
  if (stats.closed) excluded.push(`영업 안 함 ${stats.closed}곳`);
  $('#summary').innerHTML =
    esc(parts.join(' · ')) +
    (excluded.length ? `<br><small>제외: ${esc(excluded.join(', '))}</small>` : '') +
    (state.provider === 'osm' ? '<br><small>OpenStreetMap 데이터 사용 중 (카카오 키를 설정하면 식당과 가격 정보가 훨씬 많아집니다)</small>' : '');

  const empty = $('#empty');
  if (!list.length) {
    empty.hidden = false;
    empty.innerHTML = state.places.size
      ? '조건에 맞는 식당이 없습니다. 예산을 늘리거나 반경을 넓혀 보세요.'
      : '이 근처에서 식당을 찾지 못했습니다. 반경을 넓혀 보세요.';
  } else empty.hidden = true;

  if (!$('#map').hidden) updateMap(list);
}

function readConditionsSilently() {
  const people = clampInt($('#people').value, 1, 30, 1);
  const budgetRaw = Number(String($('#budget').value).replace(/,/g, ''));
  const budget = Number.isFinite(budgetRaw) && budgetRaw > 0 ? budgetRaw : null;
  const mode = $('#budget-mode').value;
  return { people, budget, mode, perPersonBudget: budget ? (mode === 'person' ? budget : budget / people) : null };
}

/* ---------- 지도 ---------- */
function updateMap(list) {
  const el = $('#map');
  if (el.hidden || !window.L || !state.center) return;
  if (!state.map) {
    state.map = L.map(el, { zoomControl: true, zoomSnap: 0.25 });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(state.map);
  }
  if (state.mapLayer) state.mapLayer.remove();
  const layer = L.layerGroup().addTo(state.map);
  state.mapLayer = layer;
  const { lat, lng } = state.center;
  L.circle([lat, lng], { radius: state.radius, color: '#d9480f', weight: 1, fillOpacity: 0.05 }).addTo(layer);
  L.circleMarker([lat, lng], { radius: 6, color: '#fff', weight: 2, fillColor: '#1864ab', fillOpacity: 1 })
    .bindTooltip(state.label)
    .addTo(layer);
  const items = (list || filtered(readConditionsSilently()).list).slice(0, 150);
  items.forEach((p, i) => {
    const popup = `<b>${i + 1}. ${esc(p.name)}</b><br>${esc(p.price.menuName)} ${p.price.isEstimate ? '약 ' : ''}${fmt(p.price.amount)}원<br><a href="${esc(p.url)}" target="_blank" rel="noopener">카카오맵</a>`;
    if (i < 20) {
      const icon = L.divIcon({
        className: '',
        html: `<span class="price-pin${p.price.isEstimate ? ' est' : ''}${i < 3 ? ' top' : ''}">${i + 1}. ${fmt(p.price.amount)}</span>`,
        iconSize: null,
      });
      L.marker([p.lat, p.lng], { icon, zIndexOffset: 1000 - i }).bindPopup(popup).addTo(layer);
    } else {
      L.circleMarker([p.lat, p.lng], { radius: 4, weight: 1, color: '#fff', fillColor: p.price.isEstimate ? '#868e96' : '#d9480f', fillOpacity: 0.9 })
        .bindPopup(popup)
        .addTo(layer);
    }
  });
  state.map.fitBounds(L.latLng(lat, lng).toBounds(state.radius * 2.1));
  setTimeout(() => state.map.invalidateSize(), 50);
}

/* ---------- 메뉴 / 가격 입력 창 ---------- */
function showMenu(p) {
  $('#menu-title').textContent = p.name;
  const date = p.menuUpdatedAt ? ` · ${p.menuUpdatedAt} 기준` : '';
  const from = p.price.source === 'goodprice' ? '착한가격업소 데이터' : '카카오맵 메뉴판';
  $('#menu-sub').textContent = `${from}${date} · 가격 낮은 순`;
  const items = [...(p.menu || [])].sort((a, b) => (a.price || Infinity) - (b.price || Infinity));
  $('#menu-list').innerHTML = items
    .map((m) => {
      const best = !p.price.isEstimate && p.price.source !== 'user' && m.name === p.price.menuName;
      const skip = m.meal === false && m.price;
      return `<li class="${best ? 'best' : skip ? 'skip' : ''}"><span>${esc(m.name)}${best ? ' ✔ 최저 한 끼' : ''}${
        skip ? ` <small>(${esc(m.note || '한 끼 아님')})</small>` : ''
      }</span><span class="price">${m.price ? fmt(m.price) + '원' : '가격 없음'}</span></li>`;
    })
    .join('');
  $('#menu-dialog').showModal();
  $('#menu-list').scrollTop = 0;
  $('#menu-title').focus();
}

/* ---------- 내가 직접 입력한 가격 (이 브라우저에 저장) ---------- */
const myPrices = {
  all: () => store.get('userPrices', {}),
  get: (id) => myPrices.all()[id] || null,
  set(id, value) {
    const all = myPrices.all();
    if (value) all[id] = value;
    else delete all[id];
    store.set('userPrices', all);
  },
};

/** 서버 가격(basePrice)은 보관하고, 내가 입력한 가격이 있으면 그걸 쓴다 */
function putPlace(place) {
  const basePrice = place.basePrice || place.price;
  const mine = myPrices.get(place.id);
  const price = mine
    ? {
        amount: mine.price,
        menuName: mine.menu || '직접 입력한 가격',
        source: 'user',
        sourceLabel: '직접 확인',
        updatedAt: mine.updatedAt,
        servings: 1,
        rawPrice: mine.price,
        isEstimate: false,
      }
    : basePrice;
  state.places.set(place.id, { ...place, basePrice, price });
}

let editing = null;
function showPriceForm(p) {
  editing = p;
  $('#price-place').textContent = p.name;
  const isUser = p.price.source === 'user';
  $('#price-menu').value = isUser ? p.price.menuName : p.price.isEstimate ? '' : p.price.menuName;
  $('#price-amount').value = isUser ? p.price.amount : '';
  $('#price-delete').hidden = !isUser;
  $('#price-dialog').showModal();
}

/* ---------- 카카오 키 ---------- */
function keyMsg(text, type = '') {
  const el = $('#key-msg');
  el.className = 'key-msg' + (type ? ' ' + type : '');
  el.innerHTML = text;
}

function showKeyCard(byUser = false) {
  const s = state.status || {};
  const card = $('#key-card');
  card.hidden = false;
  $('#key-close').hidden = !s.kakao;
  const canEdit = s.canEditKey !== false;
  $('#key-input').disabled = !canEdit;
  $('#key-save').disabled = !canEdit;
  if (!canEdit) {
    keyMsg('키는 서버를 켠 컴퓨터에서 <b>http://localhost:' + (location.port || 3000) + '</b> 으로 열어서 넣어 주세요.', 'err');
  } else if (s.kakao) {
    keyMsg(`지금 쓰는 키: <code>${esc(s.keyMasked)}</code> — 바꾸려면 새 키를 넣고 저장하세요.`);
  } else keyMsg('');
  if (byUser) {
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (canEdit) $('#key-input').focus();
  }
}

async function saveKey(e) {
  e.preventDefault();
  const key = $('#key-input').value.trim();
  if (!key) {
    keyMsg('키를 붙여넣어 주세요.', 'err');
    $('#key-input').focus();
    return;
  }
  $('#key-save').disabled = true;
  keyMsg('<span class="spin"></span> 카카오에 키를 확인하는 중…');
  try {
    const r = await api('/api/kakao-key', { method: 'POST', body: { key } });
    $('#key-input').value = '';
    await loadStatus();
    if (r.warning) {
      keyMsg(`저장했습니다. 다만 확인할 것이 있어요: ${esc(r.warning)}`, 'err');
      $('#key-card').hidden = false;
    } else {
      keyMsg(`✔ 저장했습니다 (<code>${esc(r.keyMasked)}</code>). 이제 위에서 검색하면 카카오 데이터로 찾습니다.`, 'ok');
      $('#key-card').hidden = false;
      $('#key-close').hidden = false;
    }
  } catch (err) {
    keyMsg(esc(err.message), 'err');
  } finally {
    $('#key-save').disabled = false;
  }
}

async function loadStatus() {
  try {
    const s = await api('/api/status');
    state.status = s;
    $('#key-status').textContent = s.kakao ? `(현재 키 ${s.keyMasked})` : '(아직 키 없음)';
    if (!s.kakao) {
      showKeyCard();
      notice('카카오 API 키를 넣기 전까지는 <b>OpenStreetMap</b> 데이터로 검색해서 식당 수와 가격 정보가 적습니다. 아래 칸에 키를 넣어 주세요.');
    } else if ($('#notice').textContent.includes('카카오 API 키를 넣기 전')) {
      notice('');
    }
  } catch {
    notice('서버에 연결하지 못했습니다. 서버가 켜져 있는지 확인해 주세요.', 'error');
  }
}

/* ---------- 이벤트 ---------- */
function init() {
  // 저장된 값 복원
  $('#people').value = store.get('people', 1);
  $('#budget').value = store.get('budget', '');
  $('#budget-mode').value = store.get('budgetMode', 'total');
  $('#radius').value = store.get('radius', 300);
  $('#place-radius').value = store.get('place-radius', 300);
  $('#place-query').value = store.get('placeQuery', '');
  syncRadiusButtons('radius');
  syncRadiusButtons('place-radius');

  document.querySelectorAll('.step').forEach((b) =>
    b.addEventListener('click', () => {
      const input = $('#' + b.dataset.target);
      input.value = clampInt(Number(input.value) + Number(b.dataset.step), 1, 30, 1);
      if (state.places.size) render();
    }),
  );
  document.querySelectorAll('.radius-picker').forEach((picker) => {
    const inputId = picker.dataset.input;
    picker.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-value]');
      if (!b) return;
      $('#' + inputId).value = b.dataset.value;
      syncRadiusButtons(inputId);
    });
    $('#' + inputId).addEventListener('input', () => syncRadiusButtons(inputId));
  });

  $('#nearby-form').addEventListener('submit', searchNearby);
  $('#place-form').addEventListener('submit', searchByPlace);

  // 인원/예산을 바꾸면 결과를 바로 다시 정렬
  ['#people', '#budget', '#budget-mode'].forEach((s) =>
    $(s).addEventListener('input', () => {
      if (state.places.size) {
        state.shown = PAGE;
        render();
      }
    }),
  );
  ['#only-real', '#hide-closed', '#include-bars'].forEach((s) =>
    $(s).addEventListener('change', () => {
      store.set(s, $(s).checked);
      state.shown = PAGE;
      render();
    }),
  );
  ['#only-real', '#hide-closed', '#include-bars'].forEach((s) => ($(s).checked = store.get(s, false)));

  $('#group-chips').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-group]');
    if (!b) return;
    state.group = b.dataset.group;
    state.shown = PAGE;
    render();
  });
  $('#more').addEventListener('click', () => {
    state.shown += PAGE;
    render();
  });
  $('#map-toggle').addEventListener('click', () => {
    const el = $('#map');
    if (!window.L) {
      notice('지도를 불러오지 못했습니다 (인터넷 연결 확인).');
      return;
    }
    el.hidden = !el.hidden;
    $('#map-toggle').textContent = el.hidden ? '🗺 지도 보기' : '🗺 지도 닫기';
    if (!el.hidden) updateMap();
  });

  $('#results').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const p = state.places.get(btn.closest('.result').dataset.id);
    if (!p) return;
    if (btn.dataset.act === 'menu') showMenu(p);
    if (btn.dataset.act === 'price') showPriceForm(p);
  });

  $('#price-form').addEventListener('submit', (e) => {
    if (e.submitter?.value !== 'save' || !editing) return;
    e.preventDefault();
    const price = Math.round(Number($('#price-amount').value));
    if (!price || price < 100) {
      $('#price-amount').focus();
      return;
    }
    myPrices.set(editing.id, {
      name: editing.name,
      menu: $('#price-menu').value.trim().slice(0, 100),
      price,
      updatedAt: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }),
    });
    $('#price-dialog').close();
    putPlace(state.places.get(editing.id));
    render();
  });
  $('#price-delete').addEventListener('click', () => {
    if (!editing) return;
    myPrices.set(editing.id, null);
    $('#price-dialog').close();
    putPlace(state.places.get(editing.id));
    render();
  });

  // 카카오 키 넣기
  $('#key-open').addEventListener('click', () => showKeyCard(true));
  $('#key-close').addEventListener('click', () => ($('#key-card').hidden = true));
  $('#key-form').addEventListener('submit', saveKey);

  loadStatus();

  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
