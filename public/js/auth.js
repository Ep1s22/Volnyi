/* ===================== Вход и регистрация ===================== */
const form = $('#auth-form');
const errorEl = $('#auth-error');
const mode = form.dataset.mode;           // login | register
const next = new URLSearchParams(location.search).get('next');
const goNext = () => (location.href = next && next.startsWith('/') && !next.startsWith('//') ? next : '/profile');

// уже вошли — сразу в профиль
Auth.ready.then((u) => u && goNext());

// перенос ?next= при переключении вкладок
if (next) $$('.auth__tabs a').forEach((a) => (a.href += '?next=' + encodeURIComponent(next)));

form.addEventListener('input', () => (errorEl.textContent = ''));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(form));
  // проверка на клиенте (сервер всё равно проверяет повторно)
  if (mode === 'register') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) return (errorEl.textContent = 'Введите корректную почту');
    if (f.password.length < 6) return (errorEl.textContent = 'Пароль — минимум 6 символов');
    if (f.password !== f.password2) return (errorEl.textContent = 'Пароли не совпадают');
  } else if (!f.login || !f.password) {
    return (errorEl.textContent = 'Заполните логин и пароль');
  }

  const btn = $('.auth__submit', form);
  btn.disabled = true;
  try {
    await api(mode === 'register' ? '/api/register' : '/api/login', { method: 'POST', body: f });
    goNext();
  } catch (err) {
    errorEl.textContent = err.message;
    form.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(0)' }], { duration: 300 });
  } finally { btn.disabled = false; }
});
