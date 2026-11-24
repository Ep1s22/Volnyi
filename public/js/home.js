/* ============================ Главная ============================ */

/* --- Ценности: собственный «скроллбар» слева от блоков --- */
(() => {
  const list = $('.values__list');
  const thumb = $('.values__thumb');
  const track = $('.values__track');
  if (!list) return;
  const upd = () => {
    const max = list.scrollHeight - list.clientHeight;
    const ratio = list.clientHeight / list.scrollHeight;
    thumb.style.height = Math.max(20, ratio * 100) + '%';
    thumb.style.top = (max > 0 ? (list.scrollTop / max) * (100 - ratio * 100) : 0) + '%';
  };
  list.addEventListener('scroll', upd, { passive: true });
  addEventListener('resize', upd);
  upd();
  // клик по дорожке — прокрутка к нужному месту
  track.style.cursor = 'pointer';
  track.addEventListener('click', (e) => {
    const r = track.getBoundingClientRect();
    list.scrollTo({ top: ((e.clientY - r.top) / r.height) * (list.scrollHeight - list.clientHeight), behavior: 'smooth' });
  });
})();

/* --- Новости из БД --- */
(async () => {
  const listEl = $('#news-list');
  const img = $('#news-image');
  try {
    const { news } = await api('/api/news');
    listEl.innerHTML = news.map((n, i) => `
      <li class="news__item ${i === 0 ? 'is-active' : ''}" tabindex="0" data-i="${i}">${esc(n.title)}</li>`).join('');

    let cur = 0, timer = null;
    const show = (i) => {
      cur = i;
      $$('.news__item', listEl).forEach((li) => li.classList.toggle('is-active', +li.dataset.i === i));
      const src = '/img/' + news[i].image;
      if (img.getAttribute('src') === src) return;
      img.classList.add('is-fading');
      setTimeout(() => { img.src = src; img.onload = () => img.classList.remove('is-fading'); }, 250);
    };
    show(0);

    listEl.addEventListener('mouseover', (e) => { const li = e.target.closest('.news__item'); if (li) show(+li.dataset.i); });
    // на телефоне нет наведения: картинка меняется по касанию и с клавиатуры
    listEl.addEventListener('touchstart', (e) => { const li = e.target.closest('.news__item'); if (li) { show(+li.dataset.i); stopAuto(); } }, { passive: true });
    listEl.addEventListener('focusin', (e) => { const li = e.target.closest('.news__item'); if (li) show(+li.dataset.i); });
    // на устройствах без мыши картинки ещё и листаются сами, каждые 4 секунды
    const stopAuto = () => { clearInterval(timer); timer = null; };
    if (window.matchMedia('(hover: none)').matches && news.length > 1) {
      timer = setInterval(() => { cur = (cur + 1) % news.length; show(cur); }, 4000);
    }
    const openNews = (li) => {
      const n = news[+li.dataset.i];
      openModal(`<h3>${esc(n.title)}</h3>
        <p style="font-size:13px;color:rgba(40,77,152,.45)">${new Date(n.published_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
        <p>${esc(n.body)}</p>`);
    };
    listEl.addEventListener('click', (e) => { const li = e.target.closest('.news__item'); if (li) openNews(li); });
    listEl.addEventListener('keydown', (e) => { const li = e.target.closest('.news__item'); if (li && e.key === 'Enter') openNews(li); });
  } catch (e) { listEl.innerHTML = `<li class="news__item">${esc(e.message)}</li>`; }
})();

/* --- Каталог мультфильмов из БД --- */
(async () => {
  const row = $('#catalog-list');
  try {
    const { films } = await api('/api/films');
    const catalogFilms = films.slice(0, 4);
    row.innerHTML = catalogFilms.map((f) => {
      const poster = f.poster === 'vodovorot.jpg' || f.poster === 'zagranyu.jpg' ? f.poster : '3.jpg';
      return `
        <a class="poster" href="/film?id=${f.id}" title="${esc(f.title)}">
          <img src="/img/posters/${esc(poster)}" alt="${esc(f.title)}">
        </a>`;
    }).join('');

    if (catalogFilms.length > 1) {
      let rotation = 0;
      let dragX = null;
      let dragged = false;
      const cards = $$('.poster', row);
      row.classList.add('is-ring');

      const updateRing = () => {
        const cardWidth = cards[0].getBoundingClientRect().width;
        const radius = Math.min(cardWidth * 1.7, Math.max(cardWidth * 0.55, (row.clientWidth - cardWidth) / 2));
        cards.forEach((card, i) => {
          const angle = ((i * 360 / cards.length - rotation) % 360 + 360) % 360;
          const radians = angle * Math.PI / 180;
          const depth = (Math.cos(radians) - 1) * radius * 0.55;
          const scale = 0.76 + ((Math.cos(radians) + 1) / 2) * 0.24;
          card.style.setProperty('--ring-x', `${(Math.sin(radians) * radius).toFixed(2)}px`);
          card.style.setProperty('--ring-z', `${depth.toFixed(2)}px`);
          card.style.setProperty('--card-yaw', `${(-Math.sin(radians) * 12).toFixed(2)}deg`);
          card.style.setProperty('--card-scale', scale.toFixed(3));
          card.style.setProperty('--card-tilt', `${(Math.sin(radians) * 3).toFixed(2)}deg`);
          card.style.zIndex = String(Math.round((Math.cos(radians) + 1) * 100));
        });
      };

      // Тянем карусель только после заметного сдвига пальца/мыши (порог в 8 px), иначе это обычный тап по карточке.
      // Захват указателя включаем лишь на время перетаскивания — раньше он включался на любом касании,
      // и клик не доходил до ссылки на мультфильм.
      const step = 360 / cards.length;
      const DRAG_THRESHOLD = 8;
      let startX = 0;
      const frontIndex = () => (((Math.round(rotation / step)) % cards.length) + cards.length) % cards.length;
      const snap = () => { rotation = Math.round(rotation / step) * step; updateRing(); };
      const bringToFront = (i) => {
        const delta = ((i * step - rotation) % 360 + 540) % 360 - 180; // кратчайший поворот
        rotation += delta;
        updateRing();
      };

      row.addEventListener('pointerdown', (event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        startX = dragX = event.clientX;
        dragged = false;
      });
      row.addEventListener('pointermove', (event) => {
        if (dragX === null) return;
        if (!dragged) {
          if (Math.abs(event.clientX - startX) < DRAG_THRESHOLD) return;
          dragged = true;
          dragX = event.clientX; // отсчёт вращения — с момента начала перетаскивания
          row.classList.add('is-dragging');
          try { row.setPointerCapture(event.pointerId); } catch (e) { /* не страшно */ }
          return;
        }
        rotation -= (event.clientX - dragX) * 0.35;
        dragX = event.clientX;
        updateRing();
      });
      const endDrag = () => {
        if (dragX === null) return;
        dragX = null;
        row.classList.remove('is-dragging');
        if (dragged) { snap(); setTimeout(() => { dragged = false; }, 0); }
      };
      row.addEventListener('pointerup', endDrag);
      row.addEventListener('pointercancel', endDrag);
      row.addEventListener('click', (event) => {
        // после перетаскивания клик по ссылке не нужен
        if (dragged) { event.preventDefault(); event.stopPropagation(); dragged = false; return; }
        // Боковые карточки повёрнуты в 3D, и браузер часто не считает их целью клика (клик попадает в саму ленту).
        // Поэтому карточку под пальцем ищем сами, по координатам тапа; при равенстве побеждает та, что ближе к нам.
        const hit = cards
          .filter((c) => { const r = c.getBoundingClientRect(); return event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom; })
          .sort((a, b) => (+b.style.zIndex) - (+a.style.zIndex))[0];
        if (!hit) return;
        const i = cards.indexOf(hit);
        if (i !== frontIndex()) {
          // тап по боковой карточке выводит её вперёд
          event.preventDefault(); event.stopPropagation(); bringToFront(i);
        } else if (!event.target.closest('.poster')) {
          // тап по центральной открывает мультфильм (если клик не дошёл до самой ссылки)
          event.preventDefault(); location.href = hit.getAttribute('href');
        }
      }, true);
      row.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        rotation += (event.key === 'ArrowLeft' ? 1 : -1) * 360 / cards.length;
        updateRing();
      });
      addEventListener('resize', updateRing);
      updateRing();
    }
  } catch (e) { row.textContent = e.message; }
})();

/* --- Кассовый сбор / QR-код --- */
const shellWrap = $('.fund__shell-wrap');
let shellFrames = $$('.fund__shell', shellWrap);
let shellFrame = 0;
let shellTarget = 0;
let shellTimer;
const showShellFrame = (index) => shellFrames.forEach((frame, i) => frame.classList.toggle('is-active', i === index));
const stepShell = () => {
  if (shellFrame === shellTarget) return;
  shellFrame += shellFrame < shellTarget ? 1 : -1;
  showShellFrame(shellFrame);
  shellTimer = setTimeout(stepShell, 60);
};
const setShellTarget = (open) => {
  clearTimeout(shellTimer);
  shellTarget = open ? shellFrames.length - 1 : 0;
  stepShell();
};
shellWrap.addEventListener('mouseenter', () => setShellTarget(true));
shellWrap.addEventListener('mouseleave', () => setShellTarget(false));
shellWrap.addEventListener('pointerdown', (event) => {
  if (event.pointerType !== 'mouse') setShellTarget(true);
});
shellWrap.addEventListener('click', () => setShellTarget(true));
// Если какого-то кадра анимации нет в /img/, пропускаем только его — остальные кадры играют как обычно
const dropShellFrame = (frame) => {
  if (frame === shellFrames[0] || !shellFrames.includes(frame)) return;
  clearTimeout(shellTimer);
  shellFrames = shellFrames.filter((f) => f !== frame);
  frame.remove();
  shellFrame = 0;
  shellTarget = 0;
  showShellFrame(0);
};
shellFrames.slice(1).forEach((frame) => {
  frame.addEventListener('error', () => dropShellFrame(frame), { once: true });
  if (frame.complete && !frame.naturalWidth) dropShellFrame(frame);
});

$('#fund-btn').addEventListener('click', () => {
  const m = openModal(`
    <div class="qr-modal">
      <h3>Поддержать студию</h3>
      <img src="/img/qr-cod.jpg" alt="QR-код для оплаты">
    </div>`);
  // Если QR-кода нет в public/img — вместо «битой» картинки показываем текст.
  const qr = $('.qr-modal img', m);
  qr.addEventListener('error', () => qr.replaceWith(Object.assign(document.createElement('p'), { textContent: 'QR-код для оплаты скоро появится. Спасибо, что хотите поддержать студию!' })), { once: true });
});
