(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const els = {
    form: $('#search-form'), search: $('#city-search'), popover: $('#search-popover'),
    location: $('#location-button'), theme: $('#theme-toggle'), unit: $('#unit-toggle'),
    favorite: $('#favorite-toggle'), notice: $('#notice'), scrim: $('#loading-scrim'),
    hero: $('#hero-card'), city: $('#city-name'), date: $('#date-label'), temp: $('#current-temp'),
    condition: $('#condition-label'), conditionIcon: $('#condition-icon'), feels: $('#feels-like'),
    country: $('#country-label'), daylight: $('#daylight-label'), updated: $('#updated-label'),
    hourly: $('#hourly-list'), daily: $('#daily-list'), favorites: $('#favorite-list'),
    recent: $('#recent-list'), gauge: $('#aqi-gauge'), map: $('#map-visual')
  };

  const KEY = { theme: 'weatherly-theme', unit: 'weatherly-unit', favorites: 'weatherly-favorites', recent: 'weatherly-recent' };
  const state = {
    unit: safeGet(KEY.unit) === 'f' ? 'f' : 'c',
    theme: safeGet(KEY.theme) === 'dark' ? 'dark' : 'light',
    current: null, location: null, forecast: null, air: null,
    favorites: safeJson(KEY.favorites, []), recent: safeJson(KEY.recent, []),
    loading: false, requestId: 0, searchTimer: null, mapZoom: 1, suggestionsEnabled: false
  };

  function safeGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
  function safeSet(key, value) { try { localStorage.setItem(key, value); } catch { /* Private browsing may disable storage. */ } }
  function safeJson(key, fallback) { try { const value = JSON.parse(safeGet(key) || 'null'); return Array.isArray(value) ? value : fallback; } catch { return fallback; } }
  function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
  function number(value, digits = 0) { return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—'; }
  function cToDisplay(celsius) { const value = Number(celsius); return Number.isFinite(value) ? Math.round(state.unit === 'f' ? value * 9 / 5 + 32 : value) : null; }
  function tempMarkup(celsius, suffix = '°') { const value = cToDisplay(celsius); return value === null ? '—' : `${value}${suffix}`; }
  function showNotice(message, kind = 'error') { els.notice.textContent = message; els.notice.dataset.kind = kind; els.notice.hidden = false; }
  function clearNotice() { els.notice.hidden = true; els.notice.textContent = ''; }
  function setLoading(isLoading) {
    state.loading = isLoading;
    document.body.classList.toggle('is-loading', isLoading);
    els.scrim.hidden = !isLoading;
    els.hero.setAttribute('aria-busy', String(isLoading));
  }

  const weatherInfo = (code, isDay = true) => {
    if (code === 0) return isDay ? { text: 'Ochiq', icon: '☀', type: 'clear' } : { text: 'Ochiq tun', icon: '☾', type: 'clear' };
    if ([1, 2].includes(code)) return { text: 'Qisman bulutli', icon: isDay ? '🌤' : '☁', type: 'cloudy' };
    if ([3, 45, 48].includes(code)) return { text: code >= 45 ? 'Tuman' : 'Bulutli', icon: '☁', type: 'cloudy' };
    if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { text: code >= 80 ? 'Jala' : 'Yomg‘ir', icon: '🌧', type: 'rain' };
    if ([71, 73, 75, 77, 85, 86].includes(code)) return { text: 'Qor', icon: '❄', type: 'snow' };
    if ([95, 96, 99].includes(code)) return { text: 'Momaqaldiroq', icon: '⛈', type: 'storm' };
    return { text: 'O‘zgaruvchan', icon: '🌤', type: 'cloudy' };
  };
  function compass(degrees) {
    if (!Number.isFinite(Number(degrees))) return '—';
    return ['Shimol', 'Sh-Shq', 'Shimoliy-sharq', 'Shq-Sh', 'Sharq', 'Shq-J', 'Janubi-sharq', 'J-Shq', 'Janub', 'J-G‘rb', 'Janubi-g‘arb', 'G‘rb-J', 'G‘arb', 'G‘rb-Sh', 'Shimoli-g‘arb', 'Sh-G‘rb'][Math.round(Number(degrees) / 22.5) % 16];
  }
  function formatDate(dateText, options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) {
    const parts = String(dateText || '').split('-').map(Number);
    if (parts.length < 3 || parts.some(Number.isNaN)) return '—';
    return new Intl.DateTimeFormat('uz-UZ', { ...options, timeZone: 'UTC' }).format(new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])));
  }
  function formatTime(timeText) { return timeText ? String(timeText).slice(11, 16) : '—'; }
  function daylightDuration(seconds) {
    if (!Number.isFinite(Number(seconds))) return '—';
    const minutes = Math.round(Number(seconds) / 60);
    return `${Math.floor(minutes / 60)} soat ${String(minutes % 60).padStart(2, '0')} daq`;
  }
  async function fetchJson(url) {
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Xizmat javob bermadi (${response.status})`);
    const data = await response.json();
    if (data?.error) throw new Error(data.reason || 'Xizmat ma’lumot qaytarmadi.');
    return data;
  }

  async function searchCity(query) {
    const clean = query.trim();
    if (!clean) { showNotice('Shahar nomini kiriting.'); els.search.focus(); return; }
    clearNotice();
    setLoading(true);
    const id = ++state.requestId;
    try {
      const params = new URLSearchParams({ name: clean, count: '5', language: 'uz', format: 'json' });
      const data = await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
      if (id !== state.requestId) return;
      if (!data.results?.length) throw new Error('Bu shahar topilmadi. Imlo va nomini tekshirib qayta urinib ko‘ring.');
      const place = data.results[0];
      await loadWeather({ name: place.name, country: place.country, admin1: place.admin1, latitude: place.latitude, longitude: place.longitude }, { id, recordRecent: true });
    } catch (error) {
      if (id === state.requestId) showNotice(error.message.includes('topilmadi') ? error.message : `Ob-havo ma’lumotlarini olib bo‘lmadi. ${error.message}`);
    } finally {
      if (id === state.requestId) setLoading(false);
    }
  }

  async function loadWeather(place, options = {}) {
    const id = options.id ?? ++state.requestId;
    if (!options.alreadyLoading) setLoading(true);
    try {
      const params = new URLSearchParams({
        latitude: String(place.latitude), longitude: String(place.longitude), timezone: 'auto', forecast_days: '7',
        current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,pressure_msl,surface_pressure,wind_speed_10m,wind_direction_10m,uv_index,visibility',
        hourly: 'temperature_2m,precipitation_probability,weather_code',
        daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,daylight_duration,precipitation_probability_max'
      });
      const [forecast, air] = await Promise.all([
        fetchJson(`https://api.open-meteo.com/v1/forecast?${params}`),
        fetchJson(`https://air-quality-api.open-meteo.com/v1/air-quality?${new URLSearchParams({ latitude: String(place.latitude), longitude: String(place.longitude), timezone: 'auto', current: 'us_aqi,pm2_5,pm10,carbon_monoxide,nitrogen_dioxide', hourly: 'us_aqi,pm2_5,pm10,carbon_monoxide,nitrogen_dioxide' })}`).catch(() => null)
      ]);
      if (id !== state.requestId) return;
      if (!forecast.current || !forecast.daily || !forecast.hourly) throw new Error('Prognoz javobi to‘liq emas.');
      state.location = place;
      state.forecast = forecast;
      state.air = air;
      clearNotice();
      renderWeather();
      if (options.recordRecent) addRecent(place);
    } catch (error) {
      if (id === state.requestId) showNotice(error.message.includes('to‘liq emas') ? error.message : `Ob-havo ma’lumotlari hozircha ochilmadi. Internet aloqasini tekshirib qayta urinib ko‘ring.`);
    } finally {
      if (id === state.requestId) setLoading(false);
    }
  }

  async function useMyLocation() {
    clearNotice();
    if (!navigator.geolocation) { showNotice('Bu brauzer joylashuvni aniqlashni qo‘llab-quvvatlamaydi.'); return; }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      const id = ++state.requestId;
      try {
        const reverse = await fetchJson(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(coords.latitude)}&lon=${encodeURIComponent(coords.longitude)}&zoom=10&accept-language=uz`);
        const address = reverse.address || {};
        const name = address.city || address.town || address.village || address.municipality || address.county || 'Mening joylashuvim';
        await loadWeather({ name, country: address.country || '', admin1: address.state || '', latitude: coords.latitude, longitude: coords.longitude }, { id, recordRecent: true, alreadyLoading: true });
      } catch {
        await loadWeather({ name: 'Mening joylashuvim', country: '', latitude: coords.latitude, longitude: coords.longitude }, { id, recordRecent: true, alreadyLoading: true });
      }
    }, (error) => {
      setLoading(false);
      if (error.code === error.PERMISSION_DENIED) showNotice('Joylashuvga ruxsat berilmadi. Brauzer sozlamalaridan ruxsat berishingiz yoki shaharni qidirishingiz mumkin.');
      else if (error.code === error.TIMEOUT) showNotice('Joylashuvni aniqlash vaqti tugadi. Yana urinib ko‘ring.');
      else showNotice('Joylashuvingizni aniqlab bo‘lmadi.');
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 });
  }

  function renderWeather() {
    const f = state.forecast, c = f.current, d = f.daily, place = state.location;
    const condition = weatherInfo(c.weather_code, Boolean(c.is_day));
    const countryText = [place.admin1, place.country].filter((v, i, a) => v && a.indexOf(v) === i).join(', ');
    const dateText = String(c.time || d.time?.[0] || '').slice(0, 10);
    els.city.textContent = place.name || 'Mening joylashuvim';
    els.date.textContent = formatDate(dateText);
    els.temp.innerHTML = `${cToDisplay(c.temperature_2m)}<span>°</span>`;
    els.condition.textContent = condition.text;
    els.conditionIcon.textContent = condition.icon;
    els.feels.textContent = `His qilinishi: ${tempMarkup(c.apparent_temperature)}`;
    els.country.textContent = countryText || `${number(place.latitude, 2)}°, ${number(place.longitude, 2)}°`;
    els.daylight.textContent = `Mahalliy vaqt ${formatTime(c.time)}`;
    els.hero.dataset.condition = condition.type;
    document.body.dataset.weather = c.is_day ? condition.type : 'night';
    $('#detail-feels').textContent = tempMarkup(c.apparent_temperature);
    $('#detail-humidity').textContent = `${number(c.relative_humidity_2m)}%`;
    $('#detail-wind').textContent = `${number(c.wind_speed_10m)} ${f.current_units?.wind_speed_10m || 'km/h'}`;
    $('#detail-wind-direction').textContent = `${compass(c.wind_direction_10m)} · ${number(c.wind_direction_10m)}°`;
    $('#detail-pressure').textContent = `${number(c.pressure_msl)} hPa`;
    $('#detail-visibility').textContent = Number.isFinite(Number(c.visibility)) ? `${number(c.visibility / 1000, 1)} km` : '—';
    $('#detail-uv').textContent = number(c.uv_index, 1);
    $('#uv-description').textContent = uvLabel(c.uv_index);
    $('#detail-cloud').textContent = `${number(c.cloud_cover)}%`;
    renderHourly(f);
    renderDaily(f);
    renderSun(f);
    renderAir(state.air);
    $('#map-current-temp').textContent = `${cToDisplay(c.temperature_2m)}°`;
    els.updated.textContent = `Yangilandi · ${formatTime(c.time)}`;
    renderFavorites();
  }

  function uvLabel(value) { const n = Number(value); if (!Number.isFinite(n)) return 'ultrabinafsha daraja'; if (n < 3) return 'past daraja'; if (n < 6) return 'o‘rtacha daraja'; if (n < 8) return 'yuqori daraja'; if (n < 11) return 'juda yuqori'; return 'ekstremal daraja'; }
  function renderHourly(f) {
    const times = f.hourly.time || [], startIndex = Math.max(0, times.findIndex((t) => t >= f.current.time));
    const hours = times.slice(startIndex, startIndex + 12);
    els.hourly.innerHTML = hours.map((time, index) => {
      const i = startIndex + index, info = weatherInfo(f.hourly.weather_code?.[i], true);
      const label = index === 0 ? 'Hozir' : formatTime(time);
      return `<div class="hour-card"><span class="hour-time">${label}</span><span class="hour-icon" aria-label="${escapeHtml(info.text)}">${info.icon}</span><strong class="hour-temp">${tempMarkup(f.hourly.temperature_2m?.[i])}</strong><span class="hour-rain">${number(f.hourly.precipitation_probability?.[i])}% yomg‘ir</span></div>`;
    }).join('');
  }
  function renderDaily(f) {
    els.daily.innerHTML = (f.daily.time || []).slice(0, 7).map((date, i) => {
      const info = weatherInfo(f.daily.weather_code?.[i]);
      const day = formatDate(date, { weekday: 'short' });
      const label = i === 0 ? 'Bugun' : day.charAt(0).toLocaleUpperCase('uz-UZ') + day.slice(1);
      return `<div class="day-card"><div class="day-name">${label}<span class="day-date">${formatDate(date, { day: 'numeric', month: 'short' })}</span></div><span class="day-icon" aria-label="${escapeHtml(info.text)}">${info.icon}</span><span class="day-cond">${info.text}</span><span class="day-temps">${tempMarkup(f.daily.temperature_2m_max?.[i])}<span>${tempMarkup(f.daily.temperature_2m_min?.[i])}</span></span><span class="day-rain">${number(f.daily.precipitation_probability_max?.[i])}%</span></div>`;
    }).join('');
  }
  function renderSun(f) {
    const d = f.daily;
    $('#sunrise-time').textContent = formatTime(d.sunrise?.[0]);
    $('#sunset-time').textContent = formatTime(d.sunset?.[0]);
    $('#day-length').textContent = daylightDuration(d.daylight_duration?.[0]);
    const sunrise = Number(String(d.sunrise?.[0] || '').slice(11, 13)) * 60 + Number(String(d.sunrise?.[0] || '').slice(14, 16));
    const sunset = Number(String(d.sunset?.[0] || '').slice(11, 13)) * 60 + Number(String(d.sunset?.[0] || '').slice(14, 16));
    const now = Number(String(f.current.time || '').slice(11, 13)) * 60 + Number(String(f.current.time || '').slice(14, 16));
    const position = sunset > sunrise ? Math.max(4, Math.min(96, ((now - sunrise) / (sunset - sunrise)) * 100)) : 48;
    $('#sun-orb').style.left = `${position}%`;
  }
  function renderAir(air) {
    if (!air) {
      $('#aqi-value').textContent = '—'; $('#aqi-status').textContent = 'Mavjud emas';
      $('#aqi-advice').textContent = 'Havo sifati xizmati vaqtincha javob bermadi.';
      ['pm25', 'pm10', 'co', 'no2'].forEach((id) => { $(`#${id}`).textContent = '—'; });
      els.gauge.style.setProperty('--gauge-color', '#93a3b5'); els.gauge.setAttribute('aria-label', 'Havo sifati ma’lumoti mavjud emas'); return;
    }
    const current = air.current || {}, hourly = air.hourly || {}, index = Math.max(0, (hourly.time || []).findIndex((time) => time >= (state.forecast.current.time || '')));
    const getValue = (key) => current[key] ?? hourly[key]?.[index];
    const aqi = Number(getValue('us_aqi'));
    const category = aqi <= 50 ? ['Yaxshi', 'Havo sifati yaxshi. Ochiq havoda bemalol bo‘lish mumkin.', '#56bd8d'] : aqi <= 100 ? ['O‘rtacha', 'Sezgir guruhlar uzoq vaqt tashqarida bo‘lishni kamaytirsin.', '#e4bc58'] : aqi <= 150 ? ['Sezgirlar uchun zararli', 'Sezgir guruhlar tashqi faollikni cheklasin.', '#e89c4b'] : aqi <= 200 ? ['Zararli', 'Tashqaridagi uzoq faollikni kamaytiring.', '#dc7166'] : aqi <= 300 ? ['Juda zararli', 'Tashqarida bo‘lish vaqtini cheklang.', '#a66dc1'] : ['Xavfli', 'Iloji boricha yopiq joyda qoling.', '#8e405e'];
    $('#aqi-value').textContent = Number.isFinite(aqi) ? Math.round(aqi) : '—';
    $('#aqi-status').textContent = Number.isFinite(aqi) ? category[0] : 'Mavjud emas';
    $('#aqi-advice').textContent = Number.isFinite(aqi) ? category[1] : 'Mahalliy o‘lchovlar topilmadi.';
    els.gauge.style.setProperty('--gauge-color', Number.isFinite(aqi) ? category[2] : '#93a3b5');
    els.gauge.style.setProperty('--gauge-end', `${Math.round(70 + Math.min(300, Math.max(0, aqi)) / 300 * 210)}deg`);
    els.gauge.setAttribute('aria-label', Number.isFinite(aqi) ? `Havo sifati indeksi ${Math.round(aqi)}: ${category[0]}` : 'Havo sifati ma’lumoti mavjud emas');
    [['pm25', 'pm2_5'], ['pm10', 'pm10'], ['co', 'carbon_monoxide'], ['no2', 'nitrogen_dioxide']].forEach(([id, key]) => { $(`#${id}`).textContent = number(getValue(key)); });
  }

  function persistList(key, values) { safeSet(key, JSON.stringify(values)); }
  function addRecent(place) {
    const item = { name: place.name, country: place.country || '', latitude: place.latitude, longitude: place.longitude };
    state.recent = [item, ...state.recent.filter((x) => `${x.name}-${x.country}` !== `${item.name}-${item.country}`)].slice(0, 5);
    persistList(KEY.recent, state.recent); renderRecent();
  }
  function renderRecent() {
    els.recent.innerHTML = state.recent.length ? state.recent.map((item) => `<button class="recent-city" type="button" data-lat="${Number(item.latitude)}" data-lon="${Number(item.longitude)}" data-name="${escapeHtml(item.name)}" data-country="${escapeHtml(item.country)}"><span class="recent-name"><span aria-hidden="true">↺</span>${escapeHtml(item.name)}</span><span class="recent-weather">${escapeHtml(item.country)}</span></button>`).join('') : '<p class="empty-note">Qidirilgan shaharlar shu yerda ko‘rinadi.</p>';
  }
  function isFavorite(place) { return state.favorites.some((item) => item.name.toLowerCase() === place.name.toLowerCase() && item.country === (place.country || '')); }
  function toggleFavorite() {
    if (!state.location) return;
    const item = { name: state.location.name, country: state.location.country || '', latitude: state.location.latitude, longitude: state.location.longitude };
    if (isFavorite(item)) state.favorites = state.favorites.filter((fav) => !(fav.name.toLowerCase() === item.name.toLowerCase() && fav.country === item.country));
    else if (state.favorites.length >= 6) { showNotice('Ko‘pi bilan 6 ta shaharni saqlash mumkin.', 'info'); return; }
    else state.favorites = [item, ...state.favorites];
    persistList(KEY.favorites, state.favorites); clearNotice(); renderFavorites();
  }
  function renderFavorites() {
    const place = state.location;
    const saved = place && isFavorite(place);
    els.favorite.classList.toggle('saved', Boolean(saved));
    els.favorite.setAttribute('aria-label', saved ? 'Shaharni saqlanganlardan olib tashlash' : 'Shaharni saqlanganlarga qo‘shish');
    els.favorite.title = saved ? 'Saqlanganlardan olib tashlash' : 'Saqlanganlarga qo‘shish';
    els.favorite.querySelector('span').textContent = saved ? '★' : '☆';
    $('#saved-count').textContent = `${state.favorites.length} / 6`;
    els.favorites.innerHTML = state.favorites.length ? state.favorites.map((item) => `<div class="saved-city-row"><button class="saved-city" type="button" data-lat="${Number(item.latitude)}" data-lon="${Number(item.longitude)}" data-name="${escapeHtml(item.name)}" data-country="${escapeHtml(item.country)}"><span class="saved-name"><span aria-hidden="true" class="star">★</span>${escapeHtml(item.name)}</span><span class="saved-weather">${escapeHtml(item.country)}</span></button><button class="remove-city" data-remove="${escapeHtml(item.name)}" data-country="${escapeHtml(item.country)}" type="button" aria-label="${escapeHtml(item.name)}ni olib tashlash">×</button></div>`).join('') : '<p class="empty-note">Tez kirish uchun yulduzchani bosing.</p>';
  }
  function loadStoredPlace(button) {
    const place = { name: button.dataset.name, country: button.dataset.country, latitude: Number(button.dataset.lat), longitude: Number(button.dataset.lon) };
    loadWeather(place, { recordRecent: true });
  }

  async function showSuggestions(query) {
    const clean = query.trim();
    if (clean.length < 2) { els.popover.hidden = true; els.popover.innerHTML = ''; return; }
    try {
      const data = await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: clean, count: '4', language: 'uz' })}`);
      if (!state.suggestionsEnabled || state.loading || document.activeElement !== els.search || els.search.value.trim() !== clean) return;
      els.popover.innerHTML = (data.results || []).map((place) => `<button class="suggestion" type="button" data-name="${escapeHtml(place.name)}" data-country="${escapeHtml(place.country || '')}" data-admin="${escapeHtml(place.admin1 || '')}" data-lat="${Number(place.latitude)}" data-lon="${Number(place.longitude)}"><span>${escapeHtml(place.name)}${place.admin1 ? `, ${escapeHtml(place.admin1)}` : ''}</span><small>${escapeHtml(place.country || '')}</small></button>`).join('');
      els.popover.hidden = !data.results?.length;
    } catch { els.popover.hidden = true; }
  }

  function setTheme(theme) {
    state.theme = theme;
    document.body.dataset.theme = theme;
    els.theme.setAttribute('aria-label', theme === 'dark' ? 'Yorug‘ mavzuga o‘tish' : 'Qorong‘i mavzuga o‘tish');
    els.theme.title = theme === 'dark' ? 'Yorug‘ mavzu' : 'Qorong‘i mavzu';
    els.theme.innerHTML = theme === 'dark' ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 15.3A8.5 8.5 0 0 1 8.7 3.5 8.5 8.5 0 1 0 20.5 15.3Z"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>';
    safeSet(KEY.theme, theme);
  }
  function setUnit(unit) {
    state.unit = unit === 'f' ? 'f' : 'c';
    document.querySelectorAll('.unit-choice').forEach((el) => el.classList.toggle('active', el.dataset.unit === state.unit));
    els.unit.setAttribute('aria-label', `Harorat birligi: ${state.unit === 'c' ? 'Selsiy' : 'Farengeyt'}. Boshqa birlikka almashtirish`);
    safeSet(KEY.unit, state.unit);
    if (state.forecast) renderWeather();
  }

  els.form.addEventListener('submit', (event) => { event.preventDefault(); state.suggestionsEnabled = false; els.popover.hidden = true; searchCity(els.search.value); });
  els.search.addEventListener('input', () => { state.suggestionsEnabled = true; clearTimeout(state.searchTimer); state.searchTimer = setTimeout(() => showSuggestions(els.search.value), 230); });
  els.search.addEventListener('focus', () => { state.suggestionsEnabled = true; if (els.search.value.length > 1) showSuggestions(els.search.value); });
  els.popover.addEventListener('click', (event) => {
    const button = event.target.closest('.suggestion'); if (!button) return;
    state.suggestionsEnabled = false; els.popover.hidden = true; els.search.value = button.dataset.name;
    loadWeather({ name: button.dataset.name, country: button.dataset.country, admin1: button.dataset.admin, latitude: Number(button.dataset.lat), longitude: Number(button.dataset.lon) }, { recordRecent: true });
  });
  document.addEventListener('click', (event) => { if (!event.target.closest('.search')) { state.suggestionsEnabled = false; els.popover.hidden = true; } });
  els.location.addEventListener('click', useMyLocation);
  els.theme.addEventListener('click', () => setTheme(state.theme === 'dark' ? 'light' : 'dark'));
  els.unit.addEventListener('click', () => setUnit(state.unit === 'c' ? 'f' : 'c'));
  els.favorite.addEventListener('click', toggleFavorite);
  els.favorites.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove]');
    if (remove) { state.favorites = state.favorites.filter((item) => !(item.name === remove.dataset.remove && item.country === remove.dataset.country)); persistList(KEY.favorites, state.favorites); renderFavorites(); return; }
    const button = event.target.closest('.saved-city'); if (button) loadStoredPlace(button);
  });
  els.recent.addEventListener('click', (event) => { const button = event.target.closest('.recent-city'); if (button) loadStoredPlace(button); });
  $('#zoom-in').addEventListener('click', () => { state.mapZoom = Math.min(1.35, state.mapZoom + .08); els.map.style.backgroundSize = `${100 * state.mapZoom}% ${100 * state.mapZoom}%`; });
  $('#zoom-out').addEventListener('click', () => { state.mapZoom = Math.max(.85, state.mapZoom - .08); els.map.style.backgroundSize = `${100 * state.mapZoom}% ${100 * state.mapZoom}%`; });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { state.suggestionsEnabled = false; els.popover.hidden = true; } });

  setTheme(state.theme);
  setUnit(state.unit);
  renderFavorites();
  renderRecent();
  searchCity('Toshkent');
})();
