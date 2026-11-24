/* ===================== Ивенты: карточная игра «Волнение» ===================== */
const RARITY = { common: 'Обычная', rare: 'Редкая', legendary: 'Легендарная' };
const SPIN_DURATION = 3600;
let ev = { active: null, cards: [], spinsLeft: null, events: [] };
let spinning = false;

const btn = $('#spin-btn');
const hint = $('#spin-hint');

function updateControls() {
  if (!ev.active) { btn.disabled = true; hint.textContent = 'Сейчас нет активных ивентов'; return; }
  if (!Auth.user) { btn.textContent = 'Войти и играть'; hint.textContent = 'Карточки сохраняются в профиле'; return; }
  btn.textContent = 'Крутить';
  btn.disabled = ev.spinsLeft <= 0;
  hint.textContent = ev.spinsLeft > 0 ? `Осталось попыток сегодня: ${ev.spinsLeft}` : 'Попытки на сегодня закончились — приходите завтра!';
}

async function load() {
  try {
    const [data] = await Promise.all([api('/api/events'), Auth.ready]);
    ev = data;
    $('#archive').innerHTML = data.events.map((e) => `
      <li><button class="archive__item ${e.status === 'active' ? 'is-active' : ''}" data-id="${e.id}" ${e.status === 'soon' ? 'disabled' : ''}>${esc(e.subtitle)}</button></li>`).join('');
    updateControls();
  } catch (e) { toast(e.message, true); }
}

btn.addEventListener('click', async () => {
  if (spinning) return;
  if (!Auth.user) { openAuthModal('login'); return; }
  spinning = true; btn.disabled = true;

  const flip = $('#flip');
  const inner = $('#flip-inner');
  const front = $('#flip-front');
  const game = $('.game');
  game.classList.remove('is-bowing');
  let result;
  try {
    result = await api(`/api/events/${ev.active.id}/spin`, { method: 'POST' });
  } catch (e) {
    toast(e.message, true); spinning = false; updateControls(); return;
  }

  // подготовка: сбрасываем карту лицом «рубашкой» вверх
  inner.style.transition = 'none';
  inner.style.transform = 'rotateY(0deg)';
  front.classList.add('is-pattern');
  flip.classList.remove('is-legendary');
  void inner.offsetWidth;

  // результат на обратной стороне
  const c = result.card;
  $('#flip-img').src = `/img/posters/${c.image}`;
  $('#flip-img').alt = c.name;
  $('#flip-caption').innerHTML = `${esc(c.name)}<br><span class="rarity rarity--${c.rarity}">${RARITY[c.rarity]}</span>`;
  $('.flip__new')?.remove();
  if (result.isNew) $('.flip__back').insertAdjacentHTML('beforeend', '<span class="flip__new">НОВАЯ</span>');

  // вращение: 1,5 оборота → в конце видна лицевая сторона
  game.classList.add('is-spinning');
  inner.style.transition = `transform ${SPIN_DURATION}ms cubic-bezier(.2,.75,.25,1)`;
  inner.style.transform = 'rotateY(540deg)';

  setTimeout(() => {
    game.classList.remove('is-spinning');
    if (c.rarity === 'legendary') flip.classList.add('is-legendary');
    ev.spinsLeft = result.spinsLeft;
    spinning = false;
    updateControls();
    toast(`${result.isNew ? 'Новая карточка' : 'Повторка'}: «${c.name}» · +${result.xpGained} опыта`);
  }, SPIN_DURATION + 50);
});

document.addEventListener('auth:changed', load);

/* Архив: состав сезона */
$('#archive').addEventListener('click', async (e) => {
  const b = e.target.closest('.archive__item.is-active'); if (!b) return;
  let owned = new Set();
  if (Auth.user) {
    try { owned = new Set((await api('/api/profile')).cards.map((c) => c.id)); } catch { /* гость */ }
  }
  openModal(`<h3>Волнение — 1 сезон</h3>
    <p>Крутите карту до ${ev.active.spins_per_day} раз в день и соберите всю коллекцию. Новая карточка — +20 опыта.</p>
    <div class="season">${ev.cards.map((c) => {
      const locked = Auth.user && !owned.has(c.id);
      const image = locked ? '3.jpg' : c.image;
      return `
        <figure class="${locked ? 'is-locked' : ''}">
          <img src="/img/posters/${esc(image)}" alt="${locked ? 'Обложка «Волнуй»' : ''}">
          <figcaption><b>${esc(c.name)}</b><br>${RARITY[c.rarity]}</figcaption>
        </figure>`;
    }).join('')}</div>`);
});

load();
