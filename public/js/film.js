/* ===================== Страница мультфильма / плеер ===================== */
const filmId = Number(new URLSearchParams(location.search).get('id')) || 1;
document.body.dataset.filmId = filmId;   // форма «Рецензия» в подвале привяжет отзыв к этому фильму

let state = { film: null, reviews: [], showAll: false };

const fmtDate = (s) => new Date(s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z')).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

function renderReviews() {
  const box = $('#reviews');
  const list = state.showAll ? state.reviews : state.reviews.slice(0, 4);
  box.innerHTML = list.length
    ? list.map((r, i) => `
      <article class="review is-collapsed" style="animation-delay:${i * 60}ms">
        <h3>${esc(r.author_name)}</h3>
        <p title="Нажмите, чтобы прочитать целиком">${esc(r.text)}</p>
        <time datetime="${esc(r.created_at)}">${fmtDate(r.created_at)}</time>
      </article>`).join('')
    : '<p class="reviews__empty">Рецензий пока нет — станьте первым!</p>';
  $('#reviews-all').hidden = state.showAll || state.reviews.length <= 4;
}

/* Лента «Еще» бесконечная: по краям лежат копии карточек, а после остановки прокрутки
   мы незаметно переносим ленту на «настоящие» карточки. Поэтому стрелки не упираются в конец. */
function setupMoreNav() {
  const row = $('#others'), nav = $('#more-nav'), prev = $('#more-prev'), next = $('#more-next');
  const originals = [...row.children];
  const n = originals.length;
  let W = 0, base = 0;   // W — ширина одного набора карточек, base — scrollLeft, при котором оригиналы стоят «на месте»

  const jump = (left) => {          // мгновенный перенос без анимации и без примагничивания
    row.style.scrollBehavior = 'auto'; row.style.scrollSnapType = 'none';
    row.scrollLeft = left;
    row.style.scrollBehavior = ''; row.style.scrollSnapType = '';
  };
  const pitch = () => W / n;
  const step = () => pitch() * 2;
  const clones = () => originals.map((o) => {
    const c = o.cloneNode(true);
    c.dataset.clone = '1'; c.tabIndex = -1; c.setAttribute('aria-hidden', 'true');
    return c;
  });

  const build = () => {
    row.querySelectorAll('[data-clone]').forEach((c) => c.remove());
    jump(0);
    W = 0;
    const overflow = n > 1 && row.scrollWidth - row.clientWidth > 2;
    nav.hidden = !overflow;              // всё помещается — зацикливать нечего
    if (!overflow) return;
    const r0 = originals[0].getBoundingClientRect(), r1 = originals[n - 1].getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
    const w0 = r1.right - r0.left + gap;             // примерная ширина набора
    const reps = Math.max(1, Math.ceil((row.clientWidth + w0 * 2 / n) / w0));
    for (let i = 0; i < reps; i++) { row.prepend(...clones()); row.append(...clones()); }
    const first = originals[0].getBoundingClientRect().left;
    W = row.children[(reps + 1) * n].getBoundingClientRect().left - first;   // точная ширина набора
    base = row.scrollLeft + (first - row.getBoundingClientRect().left) - (parseFloat(getComputedStyle(row).paddingLeft) || 0);
    jump(base);
  };

  const settle = () => {
    if (!W) return;
    const p = row.scrollLeft;
    if (p < base - W / 2) jump(p + W);
    else if (p >= base + W / 2) jump(p - W);
  };
  let timer;
  row.addEventListener('scroll', () => { clearTimeout(timer); timer = setTimeout(settle, 140); }, { passive: true });

  prev.onclick = () => { if (W) row.scrollBy({ left: -step(), behavior: 'smooth' }); };
  next.onclick = () => { if (W) row.scrollBy({ left: step(), behavior: 'smooth' }); };
  let rt;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(build, 200); });
  build();
}

async function load() {
  try {
    const { film, reviews, others } = await api(`/api/films/${filmId}`);
    state.film = film; state.reviews = reviews;
    document.title = `${film.title} — Волнуй`;
    const meta = `${film.genres} / ${film.year} год / ${film.country}`;
    const set = (k, v) => $$(`[data-f="${k}"]`).forEach((el) => (el.textContent = v));
    set('meta', meta); set('meta2', meta);
    set('title', film.title); set('title2', film.title);
    set('author', `Автор: ${film.author}`);
    set('short', film.short_desc);
    set('full', film.full_desc);
    set('status', film.status === 'soon' ? 'Скоро на платформе' : 'Уже доступен');
    $('[data-f="poster"]').src = `/img/posters/${film.poster}`;
    $('[data-f="poster"]').alt = film.title;

    $('#others').innerHTML = others.map((f) => `
      <a class="poster" href="/film?id=${f.id}" title="${esc(f.title)}">
        <img src="/img/posters/${esc(f.poster)}" alt="${esc(f.title)}">
      </a>`).join('');
    setupMoreNav();
    renderReviews();
  } catch (e) {
    if (e.status === 404) { location.replace('/404.html'); return; }
    toast(e.message, true);
  }
}

/* Кнопка «Больше о мультфильме» */
$('#more-btn').addEventListener('click', (e) => {
  const d = $('#film-details');
  d.hidden = !d.hidden;
  e.currentTarget.setAttribute('aria-expanded', String(!d.hidden));
  e.currentTarget.textContent = d.hidden ? 'Больше о мультфильме' : 'Скрыть подробности';
  if (!d.hidden) d.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

/* Рецензии */
$('#reviews').addEventListener('click', (e) => e.target.closest('.review')?.classList.toggle('is-collapsed'));
$('#reviews-all').addEventListener('click', () => { state.showAll = true; renderReviews(); });
$('#reviews-write').addEventListener('click', () => {
  const ta = $('[data-review-form] textarea');
  ta.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => ta.focus(), 500);
});
document.addEventListener('review:added', (e) => { state.reviews.unshift(e.detail); renderReviews(); });

/* ===================== Плеер =====================
   Видео играет прямо в первом экране.
   Пауза — показываем описание и ленту «Еще» поверх кадра. */
const DEFAULT_VIDEO = '/video/teaser.mp4';   // тизер студии — пока у мультфильма нет своего видео
const hero = $('#film-hero');
const video = $('#video');
const bar = $('#player-bar');
const seek = $('#seek');
const vol = $('#vol');
let viewSent = false;
let idleTimer = 0;

const fmtTime = (t) => {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};
const setRange = (el, part) => el.style.setProperty('--p', `${Math.max(0, Math.min(1, part)) * 100}%`);

/* Пузырьки из кнопки: всплывают невысоко и тают */
function bubbleBurst() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = $('#burst');
  const hb = hero.getBoundingClientRect();
  const pb = $('#play-btn').getBoundingClientRect();
  const cx = pb.left - hb.left + pb.width / 2;
  const cy = pb.top - hb.top + pb.height / 2;
  for (let i = 0; i < 14; i++) {
    const el = document.createElement('span');
    const size = 6 + Math.random() * 14;
    const x = cx + (Math.random() - 0.5) * pb.width * 1.4;
    const y = cy + (Math.random() - 0.2) * pb.height * 0.6;
    el.className = 'bubble';
    el.style.cssText = `left:${x - size / 2}px;top:${y - size / 2}px;width:${size}px;height:${size}px`;
    box.append(el);
    const rise = 50 + Math.random() * 70;            // не выше ~120px
    const sway = (Math.random() - 0.5) * 40;
    el.animate([
      { transform: 'translate(0,0) scale(.4)', opacity: 0 },
      { transform: `translate(${sway * 0.4}px,${-rise * 0.35}px) scale(1)`, opacity: 0.95, offset: 0.25 },
      { transform: `translate(${sway}px,${-rise}px) scale(1.05)`, opacity: 0 },
    ], { duration: 1300 + Math.random() * 900, delay: Math.random() * 250, easing: 'cubic-bezier(.22,.8,.3,1)', fill: 'both' })
      .finished.then(() => el.remove(), () => el.remove());
  }
}

function setState() {
  const playing = !video.paused && !video.ended;
  hero.classList.toggle('is-playing', playing);
  hero.classList.toggle('is-paused', !playing);
  $('[data-act="toggle"]', bar).setAttribute('aria-label', playing ? 'Пауза' : 'Смотреть');
  $('#play-btn').setAttribute('aria-label', video.ended ? 'Смотреть ещё раз' : 'Продолжить просмотр');
  if (playing) wake(); else { clearTimeout(idleTimer); hero.classList.remove('is-idle'); }
}

/* панель прячется, если мышь не двигается во время просмотра */
function wake() {
  hero.classList.remove('is-idle');
  clearTimeout(idleTimer);
  if (!video.paused) idleTimer = setTimeout(() => hero.classList.add('is-idle'), 2500);
}

async function markViewed() {
  if (viewSent || !state.film) return;
  viewSent = true;
  try {
    const r = await api(`/api/films/${state.film.id}/view`, { method: 'POST' });
    if (r.xpGained) toast(`+${r.xpGained} опыта за просмотр`);
    else if (!r.saved) toast('Войдите, чтобы история просмотров сохранялась');
  } catch { /* не критично */ }
}

async function startPlayer() {
  const f = state.film;
  if (!f) return;
  const src = f.video_url || DEFAULT_VIDEO;
  if (!hero.classList.contains('is-video')) {
    if (video.getAttribute('src') !== src) {
      video.src = src;
      video.poster = '';
    }
    bubbleBurst();
    hero.classList.add('is-video');
    if (scrollY > 10) scrollTo({ top: 0, behavior: 'smooth' });
    bar.hidden = false;
    if (!f.video_url) toast(`«${f.title}» ещё в производстве — пока смотрите тизер студии`);
  }
  if (video.ended) video.currentTime = 0;
  try { await video.play(); }
  catch (e) {
    if (e.name !== 'AbortError') toast('Не удалось запустить видео. Проверьте, что файл ролика лежит на сервере.', true);
    setState();
  }
  markViewed();
}

function closePlayer() {
  video.pause();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  hero.classList.remove('is-video', 'is-playing', 'is-paused', 'is-idle');
  bar.hidden = true;
  $('#play-btn').setAttribute('aria-label', 'Смотреть мультфильм');
}

const togglePlay = () => (video.paused || video.ended ? startPlayer() : video.pause());

$('#play-btn').addEventListener('click', startPlayer);
$('#screen').addEventListener('click', togglePlay);

bar.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'toggle') togglePlay();
  if (act === 'mute') video.muted = !video.muted;
  if (act === 'close') closePlayer();
  if (act === 'fullscreen') {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (hero.requestFullscreen) hero.requestFullscreen().catch(() => {});
    else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();   // iPhone
  }
});

video.addEventListener('play', setState);
video.addEventListener('pause', setState);
video.addEventListener('ended', setState);
video.addEventListener('waiting', () => hero.classList.add('is-loading'));
video.addEventListener('playing', () => hero.classList.remove('is-loading'));
video.addEventListener('error', () => {
  if (!hero.classList.contains('is-video')) return;
  toast('Видео не найдено на сервере', true);
  closePlayer();
});
video.addEventListener('loadedmetadata', () => { $('#t-dur').textContent = fmtTime(video.duration); });
video.addEventListener('timeupdate', () => {
  $('#t-cur').textContent = fmtTime(video.currentTime);
  if (!seek.matches(':active') && video.duration) {
    seek.value = Math.round((video.currentTime / video.duration) * 1000);
    setRange(seek, video.currentTime / video.duration);
  }
});
seek.addEventListener('input', () => {
  if (!video.duration) return;
  video.currentTime = (seek.value / 1000) * video.duration;
  setRange(seek, seek.value / 1000);
});
video.addEventListener('volumechange', () => {
  hero.classList.toggle('is-muted', video.muted || video.volume === 0);
  $('[data-act="mute"]', bar).setAttribute('aria-label', video.muted ? 'Включить звук' : 'Выключить звук');
  vol.value = video.muted ? 0 : video.volume;
  setRange(vol, vol.value);
});
vol.addEventListener('input', () => { video.volume = Number(vol.value); video.muted = video.volume === 0; });
setRange(vol, 1);

hero.addEventListener('pointermove', () => { if (hero.classList.contains('is-playing')) wake(); });
bar.addEventListener('focusin', wake);

/* Клавиши: пробел — пауза, ←/→ — 5 секунд, F — весь экран, M — звук */
document.addEventListener('keydown', (e) => {
  if (!hero.classList.contains('is-video') || $('.modal')) return;
  if (e.target.closest('input:not([type=range]), textarea, a, button')) return;
  const k = e.key.toLowerCase();
  if (k === ' ' || k === 'k' || k === 'л') { e.preventDefault(); togglePlay(); }
  else if (e.key === 'ArrowRight') { video.currentTime = Math.min(video.duration || 0, video.currentTime + 5); wake(); }
  else if (e.key === 'ArrowLeft') { video.currentTime = Math.max(0, video.currentTime - 5); wake(); }
  else if (k === 'f' || k === 'а') $('[data-act="fullscreen"]', bar).click();
  else if (k === 'm' || k === 'ь') video.muted = !video.muted;
});

load();
