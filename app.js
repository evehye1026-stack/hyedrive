// hyedrive - 사내 차량 예약 SPA
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const DEPARTMENTS = ['총무팀', '개발팀', '마케팅팀', '인사팀', '경영지원팀', '영업팀'];

let vehicles = [];
let activeReservations = []; // status in (예약됨, 대여중) - 시간 중복 판단용
let selectedVehicle = null;

// ---------- 유틸 ----------
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function formatDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
}

function toLocalInputValue(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------- 데이터 로드 (오프라인 시 마지막으로 불러온 데이터로 대체) ----------
const CACHE_VEHICLES_KEY = 'hyedrive_cache_vehicles';
const CACHE_RESERVATIONS_KEY = 'hyedrive_cache_reservations';

function readCache(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function loadVehicles() {
  const { data, error } = await supabaseClient
    .from('vehicles')
    .select('*')
    .order('plate_number', { ascending: true });
  if (error) {
    console.error(error);
    const cached = readCache(CACHE_VEHICLES_KEY);
    if (cached) {
      vehicles = cached;
      if (navigator.onLine) showToast('차량 정보를 불러오지 못했습니다. 이전 화면을 표시합니다.', 'error');
    } else {
      vehicles = [];
      showToast('차량 정보를 불러오지 못했습니다.', 'error');
    }
    return;
  }
  vehicles = data || [];
  localStorage.setItem(CACHE_VEHICLES_KEY, JSON.stringify(vehicles));
}

async function loadActiveReservations() {
  const { data, error } = await supabaseClient
    .from('reservations')
    .select('*')
    .in('status', ['예약됨', '대여중']);
  if (error) {
    console.error(error);
    const cached = readCache(CACHE_RESERVATIONS_KEY);
    if (cached) {
      activeReservations = cached;
      if (navigator.onLine) showToast('예약 정보를 불러오지 못했습니다. 이전 화면을 표시합니다.', 'error');
    } else {
      activeReservations = [];
      showToast('예약 정보를 불러오지 못했습니다.', 'error');
    }
    return;
  }
  activeReservations = data || [];
  localStorage.setItem(CACHE_RESERVATIONS_KEY, JSON.stringify(activeReservations));
}

async function refreshDashboard() {
  await Promise.all([loadVehicles(), loadActiveReservations()]);
  renderVehicleGrid();
}

// ---------- 겹침 판단 ----------
function isOverlapping(vehicleId, start, end) {
  return activeReservations.some((r) => {
    if (r.vehicle_id !== vehicleId) return false;
    return new Date(r.start_at) < end && new Date(r.end_at) > start;
  });
}

function nextAvailableHint(vehicleId, start) {
  const upcoming = activeReservations
    .filter((r) => r.vehicle_id === vehicleId && new Date(r.end_at) > start)
    .sort((a, b) => new Date(a.end_at) - new Date(b.end_at));
  if (upcoming.length === 0) return '';
  return `다음 예약 가능: ${formatDateTime(upcoming[0].end_at)} 이후`;
}

// ---------- 필터 ----------
function getFilters() {
  return {
    department: document.getElementById('filter-department').value,
    fuel: document.getElementById('filter-fuel').value,
    capacity: document.getElementById('filter-capacity').value,
    status: document.getElementById('filter-status').value,
    startRaw: document.getElementById('filter-start').value,
    endRaw: document.getElementById('filter-end').value,
  };
}

// ---------- 렌더링 ----------
function renderVehicleGrid() {
  const grid = document.getElementById('vehicle-grid');
  const filters = getFilters();

  let start = null;
  let end = null;
  const timeRangeSelected = !!(filters.startRaw && filters.endRaw);
  if (timeRangeSelected) {
    start = new Date(filters.startRaw);
    end = new Date(filters.endRaw);
    if (end <= start) {
      grid.innerHTML = '<p class="empty-text">반납예정일시는 출발일시보다 이후여야 합니다.</p>';
      return;
    }
  }

  const filtered = vehicles.filter((v) => {
    if (filters.department && v.department !== filters.department) return false;
    if (filters.fuel && v.fuel_type !== filters.fuel) return false;
    if (filters.capacity && v.capacity < Number(filters.capacity)) return false;
    if (filters.status && v.status !== filters.status) return false;
    return true;
  });

  if (filtered.length === 0) {
    grid.innerHTML = '<p class="empty-text">조건에 맞는 차량이 없습니다.</p>';
    return;
  }

  grid.innerHTML = '';
  filtered.forEach((v) => {
    let disabled = false;
    let statusLine = '';

    if (v.status === '정비중') {
      disabled = true;
      statusLine = '정비중인 차량입니다.';
    } else if (timeRangeSelected) {
      if (isOverlapping(v.id, start, end)) {
        disabled = true;
        statusLine = '선택한 시간대에 이미 예약이 있습니다.';
        const hint = nextAvailableHint(v.id, start);
        if (hint) statusLine += ` (${hint})`;
      }
    } else if (v.status === '운행중') {
      disabled = true;
      statusLine = '현재 운행중입니다.';
    }

    const isAvailable = !disabled && timeRangeSelected;

    const card = document.createElement('div');
    card.className = `vehicle-card ${isAvailable ? 'available' : ''} ${disabled ? 'disabled' : ''}`;

    card.innerHTML = `
      <div class="card-top">
        <div>
          <div class="plate-number">${v.plate_number}</div>
          <div class="model-name">${v.model} · ${v.year}</div>
        </div>
        <span class="badge badge-${v.status}">${v.status}</span>
      </div>
      <div class="card-info">
        <div><span>정원</span>${v.capacity}인승</div>
        <div><span>연료</span>${v.fuel_type}</div>
        <div><span>부서</span>${v.department}</div>
        <div><span>색상</span>${v.color || '-'}</div>
      </div>
      ${statusLine ? `<div class="card-status-line">${statusLine}</div>` : ''}
      ${isAvailable ? '<div class="card-available-tag">예약 가능 · 클릭하여 예약</div>' : ''}
    `;

    card.addEventListener('click', () => {
      if (disabled) return;
      if (!timeRangeSelected) {
        showToast('이용 희망 일시(출발/반납예정)를 먼저 선택해주세요.', 'error');
        return;
      }
      openReservationModal(v, filters.startRaw, filters.endRaw);
    });

    grid.appendChild(card);
  });
}

// ---------- 예약 모달 ----------
function openReservationModal(vehicle, startRaw, endRaw) {
  selectedVehicle = vehicle;
  const summary = document.getElementById('vehicle-summary');
  summary.innerHTML = `
    <div><span>차량번호</span>${vehicle.plate_number}</div>
    <div><span>차종</span>${vehicle.model}</div>
    <div><span>정원</span>${vehicle.capacity}인승</div>
    <div><span>연료</span>${vehicle.fuel_type}</div>
    <div><span>부서</span>${vehicle.department}</div>
    <div><span>주차위치</span>${vehicle.parking_location || '-'}</div>
  `;

  document.getElementById('res-start').value = startRaw || '';
  document.getElementById('res-end').value = endRaw || '';
  document.getElementById('res-name').value = localStorage.getItem('hyedrive_reserver_name') || '';
  document.getElementById('res-department').value = '';
  document.getElementById('res-purpose').value = '';
  document.getElementById('reservation-form-error').textContent = '';

  document.getElementById('reservation-modal').hidden = false;
  hideInstallBanner(); // 모달이 배너를 가리지 않도록 잠시 숨김
}

function closeReservationModal() {
  document.getElementById('reservation-modal').hidden = true;
  selectedVehicle = null;
  if (installBannerMode) showInstallBanner(installBannerMode);
}

async function handleReservationSubmit(e) {
  e.preventDefault();
  if (!selectedVehicle) return;

  const errorEl = document.getElementById('reservation-form-error');
  errorEl.textContent = '';

  const startRaw = document.getElementById('res-start').value;
  const endRaw = document.getElementById('res-end').value;
  const name = document.getElementById('res-name').value.trim();
  const department = document.getElementById('res-department').value;
  const purpose = document.getElementById('res-purpose').value.trim();

  if (!startRaw || !endRaw || !name || !department || !purpose) {
    errorEl.textContent = '모든 항목을 입력해주세요.';
    return;
  }
  const start = new Date(startRaw);
  const end = new Date(endRaw);
  if (end <= start) {
    errorEl.textContent = '반납예정일시는 출발일시보다 이후여야 합니다.';
    return;
  }

  const submitBtn = document.getElementById('reservation-submit-btn');
  submitBtn.disabled = true;

  const { data, error } = await supabaseClient
    .from('reservations')
    .insert({
      vehicle_id: selectedVehicle.id,
      reserver_name: name,
      department,
      purpose,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
    })
    .select()
    .single();

  submitBtn.disabled = false;

  if (error) {
    console.error(error);
    // 23P01: PostgreSQL EXCLUDE 제약 위반 (시간대 중복 예약)
    if (error.code === '23P01') {
      errorEl.textContent = '선택한 시간에 이미 예약이 있습니다. 다른 시간을 선택해주세요.';
    } else {
      errorEl.textContent = '예약에 실패했습니다. 잠시 후 다시 시도해주세요.';
    }
    return;
  }

  localStorage.setItem('hyedrive_reserver_name', name);
  showToast(`예약이 완료되었습니다. (예약번호: ${data.reservation_number})`, 'success');
  closeReservationModal();
  await refreshDashboard();
}

// ---------- 내 예약 ----------
async function loadMyReservations() {
  const nameInput = document.getElementById('my-name-input');
  const name = nameInput.value.trim();
  const listEl = document.getElementById('my-reservations-list');

  if (!name) {
    listEl.innerHTML = '<p class="empty-text">이름을 입력하고 조회 버튼을 눌러주세요.</p>';
    return;
  }
  localStorage.setItem('hyedrive_reserver_name', name);

  listEl.innerHTML = '<p class="loading-text">조회 중...</p>';

  const { data, error } = await supabaseClient
    .from('reservations')
    .select('*, vehicles(plate_number, model)')
    .eq('reserver_name', name)
    .order('start_at', { ascending: false });

  if (error) {
    console.error(error);
    listEl.innerHTML = '<p class="empty-text">예약 정보를 불러오지 못했습니다.</p>';
    return;
  }

  if (!data || data.length === 0) {
    listEl.innerHTML = '<p class="empty-text">예약 내역이 없습니다.</p>';
    return;
  }

  listEl.innerHTML = '';
  data.forEach((r) => {
    const item = document.createElement('div');
    item.className = 'reservation-item';

    const vehicleLabel = r.vehicles ? `${r.vehicles.plate_number} (${r.vehicles.model})` : '-';

    let actionsHtml = '';
    if (r.status === '예약됨') {
      actionsHtml = `<button class="btn btn-secondary btn-small" data-action="cancel" data-id="${r.id}">예약 취소</button>`;
    } else if (r.status === '대여중') {
      actionsHtml = `<button class="btn btn-primary btn-small" data-action="return" data-id="${r.id}">반납 처리</button>`;
    }

    item.innerHTML = `
      <div class="res-info">
        <span class="res-number">${escapeHtml(r.reservation_number)}</span>
        <span class="badge badge-${r.status}">${r.status}</span><br/>
        차량: ${escapeHtml(vehicleLabel)} · 부서: ${escapeHtml(r.department)}<br/>
        목적: ${escapeHtml(r.purpose)}<br/>
        기간: ${formatDateTime(r.start_at)} ~ ${formatDateTime(r.end_at)}
        ${r.actual_return_at ? `<br/>실제 반납: ${formatDateTime(r.actual_return_at)}` : ''}
      </div>
      <div class="res-actions">${actionsHtml}</div>
    `;
    listEl.appendChild(item);
  });

  listEl.querySelectorAll('[data-action="cancel"]').forEach((btn) => {
    btn.addEventListener('click', () => handleCancelReservation(btn.dataset.id));
  });
  listEl.querySelectorAll('[data-action="return"]').forEach((btn) => {
    btn.addEventListener('click', () => handleReturnReservation(btn.dataset.id));
  });
}

async function handleCancelReservation(id) {
  if (!confirm('예약을 취소하시겠습니까?')) return;
  const { error } = await supabaseClient
    .from('reservations')
    .update({ status: '취소' })
    .eq('id', id)
    .eq('status', '예약됨');

  if (error) {
    console.error(error);
    showToast('예약 취소에 실패했습니다.', 'error');
    return;
  }
  showToast('예약이 취소되었습니다.', 'success');
  await loadMyReservations();
}

async function handleReturnReservation(id) {
  if (!confirm('반납 처리하시겠습니까?')) return;
  const { error } = await supabaseClient
    .from('reservations')
    .update({ status: '반납완료', actual_return_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', '대여중');

  if (error) {
    console.error(error);
    showToast('반납 처리에 실패했습니다.', 'error');
    return;
  }
  showToast('반납 처리되었습니다.', 'success');
  await loadMyReservations();
}

// ---------- 탭 전환 ----------
function switchView(viewId) {
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== viewId; });
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === viewId);
  });
}

// ---------- 이벤트 바인딩 ----------
function bindEvents() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  ['filter-department', 'filter-fuel', 'filter-capacity', 'filter-status', 'filter-start', 'filter-end']
    .forEach((id) => {
      document.getElementById(id).addEventListener('change', renderVehicleGrid);
      document.getElementById(id).addEventListener('input', renderVehicleGrid);
    });

  document.getElementById('filter-reset-btn').addEventListener('click', () => {
    document.getElementById('filter-department').value = '';
    document.getElementById('filter-fuel').value = '';
    document.getElementById('filter-capacity').value = '';
    document.getElementById('filter-status').value = '';
    document.getElementById('filter-start').value = '';
    document.getElementById('filter-end').value = '';
    renderVehicleGrid();
  });

  document.getElementById('modal-close-btn').addEventListener('click', closeReservationModal);
  document.getElementById('modal-cancel-btn').addEventListener('click', closeReservationModal);
  document.getElementById('reservation-modal').addEventListener('click', (e) => {
    if (e.target.id === 'reservation-modal') closeReservationModal();
  });
  document.getElementById('reservation-form').addEventListener('submit', handleReservationSubmit);

  document.getElementById('my-name-search-btn').addEventListener('click', loadMyReservations);
  document.getElementById('my-name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadMyReservations();
  });
}

// ---------- 실시간 구독 ----------
function subscribeRealtime() {
  supabaseClient
    .channel('hyedrive-vehicles-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, () => {
      refreshDashboard();
    })
    .subscribe();

  supabaseClient
    .channel('hyedrive-reservations-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, () => {
      refreshDashboard();
      const myView = document.getElementById('my-reservations-view');
      if (!myView.hidden) loadMyReservations();
    })
    .subscribe();
}

// ---------- 서비스 워커 (PWA) ----------
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.error('서비스 워커 등록 실패', err);
    });
  });
}

// ---------- 오프라인 상태 배너 ----------
function updateOnlineStatus() {
  const banner = document.getElementById('offline-banner');
  if (!banner) return;
  banner.hidden = navigator.onLine;
}

function setupOnlineStatus() {
  updateOnlineStatus();
  window.addEventListener('online', () => {
    updateOnlineStatus();
    refreshDashboard();
  });
  window.addEventListener('offline', updateOnlineStatus);
}

// ---------- 홈 화면에 추가 안내 배너 ----------
let deferredInstallPrompt = null;
let installBannerMode = null;
const INSTALL_DISMISSED_KEY = 'hyedrive_install_dismissed';

function isStandaloneDisplay() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isMobileDevice() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function isIOSDevice() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function showInstallBanner(mode) {
  installBannerMode = mode;
  if (localStorage.getItem(INSTALL_DISMISSED_KEY) === 'true') return;
  const banner = document.getElementById('install-banner');
  const text = document.getElementById('install-banner-text');
  const actionBtn = document.getElementById('install-banner-action-btn');
  if (!banner) return;

  if (mode === 'android') {
    text.textContent = '홈 화면에 추가하고 앱처럼 더 빠르게 이용하세요.';
    actionBtn.hidden = false;
  } else {
    text.textContent = 'Safari 공유 버튼을 누른 뒤 "홈 화면에 추가"를 선택하면 앱처럼 설치할 수 있어요.';
    actionBtn.hidden = true;
  }
  banner.hidden = false;
}

function hideInstallBanner() {
  const banner = document.getElementById('install-banner');
  if (banner) banner.hidden = true;
}

function dismissInstallBanner() {
  hideInstallBanner();
  localStorage.setItem(INSTALL_DISMISSED_KEY, 'true');
}

function setupInstallPrompt() {
  if (isStandaloneDisplay() || !isMobileDevice()) return;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    showInstallBanner('android');
  });

  window.addEventListener('appinstalled', () => {
    localStorage.setItem(INSTALL_DISMISSED_KEY, 'true');
    hideInstallBanner();
  });

  if (isIOSDevice()) {
    showInstallBanner('ios');
  }

  document.getElementById('install-banner-close-btn').addEventListener('click', dismissInstallBanner);
  document.getElementById('install-banner-action-btn').addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    hideInstallBanner();
  });
}

// ---------- 초기화 ----------
async function init() {
  const savedName = localStorage.getItem('hyedrive_reserver_name');
  if (savedName) document.getElementById('my-name-input').value = savedName;

  bindEvents();
  await refreshDashboard();
  subscribeRealtime();
  registerServiceWorker();
  setupOnlineStatus();
  setupInstallPrompt();
}

document.addEventListener('DOMContentLoaded', init);
