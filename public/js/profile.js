/* ============================ Профиль ============================ */
const RARITY = { common: 'Обычная', rare: 'Редкая', legendary: 'Легендарная' };

/* Духи вокруг аватара: при наведении крутятся по кругу (по часовой стрелке),
   при уходе мыши плавно тормозят в ту же сторону, а не откатываются назад. */
const profileHero = $('.profile-hero');
const avatarArea = $('.profile-hero__avatar');
const orbits = $$('.profile-hero__orbit');
const SPIN_MS = 9000;                       // один оборот при наведении
const SPEED = 360 / SPIN_MS;                // градусов в миллисекунду
const STOP_MS = 1400;                       // время торможения
// easeOutCubic начинается со скоростью ×3 от средней — подбираем путь так,
// чтобы скорость в момент остановки совпала со скоростью вращения (без рывка)
const STOP_DEG = (SPEED * STOP_MS) / 3;

const angleOf = (el) => parseFloat(getComputedStyle(el).rotate) || 0;
// запоминаем текущий угол и снимаем анимации — дух остаётся там, где был
function freeze(orbit) {
  const angle = angleOf(orbit);
  orbit.getAnimations().forEach((an) => an.cancel());
  orbit.style.rotate = `${angle}deg`;
  return angle;
}

avatarArea.addEventListener('pointerenter', (event) => {
  if (event.pointerType !== 'mouse') return;
  profileHero.classList.add('profile-hero--ghosts-active');
  orbits.forEach((orbit) => {
    const angle = freeze(orbit);
    orbit.animate([{ rotate: `${angle}deg` }, { rotate: `${angle + 360}deg` }],
      { duration: SPIN_MS, iterations: Infinity, easing: 'linear' });
  });
});

avatarArea.addEventListener('pointerleave', (event) => {
  if (event.pointerType !== 'mouse') return;
  profileHero.classList.remove('profile-hero--ghosts-active');
  orbits.forEach((orbit) => {
    const angle = freeze(orbit);
    const end = angle + STOP_DEG;             // та же сторона, что и вращение
    const stop = orbit.animate([{ rotate: `${angle}deg` }, { rotate: `${end}deg` }],
      { duration: STOP_MS, easing: 'cubic-bezier(.33, 1, .68, 1)', fill: 'forwards' });
    stop.finished.then(() => {
      orbit.style.rotate = `${end % 360}deg`;
      stop.cancel();
    }).catch(() => {});
  });
});

function renderUser(u) {
  $('#p-name').textContent = u.name;
  $('#p-nick').textContent = '@' + u.username;
  $('#avatar').src = '/img/' + u.avatar;
  $('#p-level').textContent = `Уровень ${u.level}`;
  $('#p-xp').textContent = `${u.progress}/${u.need}`;
  requestAnimationFrame(() => ($('#p-bar').style.width = (u.progress / u.need) * 100 + '%'));
  const link = $('[data-auth-link]'); if (link) link.textContent = u.name;
}

async function load() {
  let data;
  try { data = await api('/api/profile'); } catch (e) {
    if (e.status === 401) { location.href = '/login?next=/profile'; return; }
    toast(e.message, true); return;
  }
  const { user, cards, totalCards, viewed } = data;
  renderUser(user);

  // карточки: полученные + «закрытые» места под остальные
  $('#cards-count').textContent = `${cards.length}/${totalCards}`;
  $('#cards').innerHTML = cards.length
    ? cards.map((c, i) => `
        <button class="card card--owned" data-i="${i}" title="${esc(c.name)}">
          <img src="/img/posters/${esc(c.image)}" alt="${esc(c.name)}">
          ${c.count > 1 ? `<span class="card__count">×${c.count}</span>` : ''}
        </button>`).join('')
    : '<p class="cards__empty">Полученных карточек пока нет</p>';

  $('#cards').addEventListener('click', (e) => {
    const b = e.target.closest('.card--owned'); if (!b) return;
    const c = cards[+b.dataset.i];
    openModal(`<div class="card-modal">
      <img src="/img/posters/${esc(c.image)}" alt="">
      <h3>${esc(c.name)}</h3>
      <p><span class="rarity rarity--${c.rarity}">${RARITY[c.rarity]}</span>${c.count > 1 ? ` · у вас ${c.count} шт.` : ''}</p>
      <p>Получена ${new Date(c.first_at.replace(' ', 'T') + (c.first_at.endsWith('Z') ? '' : 'Z')).toLocaleDateString('ru-RU')}</p>
    </div>`);
  });

  // просмотренные мультфильмы
  $('#viewed').innerHTML = viewed.length
    ? viewed.map((f) => `
      <a class="watched" href="/film?id=${f.id}">
        <img src="/img/posters/${esc(f.poster)}" alt="">
        <div>
          <h3>${esc(f.title)}${f.status === 'soon' ? ' (Скоро)' : ''}</h3>
          <p class="watched__meta">${esc(f.genres)} / ${f.year} год / ${esc(f.country)}</p>
          ${f.short_desc === 'Будет позже'
            ? '<p>Будет позже<br>Будет позже<br>Будет позже<br>Будет позже</p>'
            : `<p>О мультфильме<br>${esc(f.short_desc)}</p>`}
        </div>
      </a>`).join('')
    : '<p class="viewed__empty">Вы ещё ничего не смотрели. <a href="/film">Открыть плеер</a></p>';

  // редактирование
  $('#edit-btn').onclick = () => {
    const m = openModal(`
      <h3>Редактировать профиль</h3>
      <form id="edit-form">
        <label class="field"><input name="name" maxlength="60" required value="${esc(user.name)}"><span>Имя</span></label>
        <label class="field"><input name="username" maxlength="30" required pattern="@?[A-Za-z0-9_]{3,30}" value="@${esc(user.username)}"><span>@имя — латиница, цифры и _</span></label>
        <label class="field"><input value="${esc(user.email)}" disabled><span>Почта</span></label>
        <button class="btn btn--small" style="width:100%">Сохранить</button>
      </form>
      <p style="text-align:center;margin:16px 0 0"><button class="reviews__link" id="logout" style="color:#284D98">Выйти из аккаунта</button></p>`);
    $('#logout', m).onclick = () => Auth.logout();
    $('#edit-form', m).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        const { user: u } = await api('/api/me', { method: 'PUT', body: { name: f.name.value, username: f.username.value } });
        Object.assign(user, u); renderUser(u); m.close(); toast('Профиль сохранён');
      } catch (err) { toast(err.message, true); }
    });
  };
}

/* Стрелки карусели карточек */
$$('.cards__arrow').forEach((b) => b.addEventListener('click', () => {
  const row = $('#cards');
  const card = $('.card', row);
  const step = card ? card.getBoundingClientRect().width + parseFloat(getComputedStyle(row).columnGap || 0) : 200;
  row.scrollBy({ left: step * Number(b.dataset.dir), behavior: 'smooth' });
}));

load();
