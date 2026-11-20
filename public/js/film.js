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

/* Плеер: видео, если оно уже вышло, иначе — экран «скоро» */
$('#play-btn').addEventListener('click', async () => {
  const f = state.film;
  if (!f) return;
  const m = openModal(f.video_url
    ? `<video src="${esc(f.video_url)}" controls autoplay playsinline poster="/img/posters/${esc(f.poster)}"></video>`
    : `<div class="player__soon">
         <img src="/img/posters/${esc(f.poster)}" alt="">
         <div>
           <h3>«${esc(f.title)}» — скоро</h3>
           <p>Мультфильм ещё в производстве. Мы добавили его в раздел «Просмотрено» вашего профиля, чтобы вы не пропустили премьеру.</p>
           <p>Поддержите студию на главной странице — это приблизит выход!</p>
         </div>
       </div>`);
  m.classList.add('player');
  try {
    const r = await api(`/api/films/${f.id}/view`, { method: 'POST' });
    if (r.xpGained) toast(`+${r.xpGained} опыта за просмотр`);
    else if (!r.saved) toast('Войдите, чтобы история просмотров сохранялась');
  } catch { /* не критично */ }
});

load();
