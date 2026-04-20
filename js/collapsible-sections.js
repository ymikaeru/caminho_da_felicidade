document.addEventListener('DOMContentLoaded', () => {
  const topicList = document.querySelector('.topic-list');
  if (!topicList) return;

  const headers = Array.from(topicList.querySelectorAll('h2.section-header'));
  if (headers.length === 0) return;

  const volMatch = window.location.pathname.match(/mioshiec\d/);
  const volKey = volMatch ? volMatch[0] : 'vol';

  headers.forEach(header => {
    const sectionId = header.id || ('s' + Math.random().toString(36).slice(2));

    const items = [];
    let el = header.nextElementSibling;
    while (el && el.tagName !== 'HR' && !el.classList.contains('section-header')) {
      items.push(el);
      el = el.nextElementSibling;
    }
    if (items.length === 0) return;

    const chevron = document.createElement('span');
    chevron.setAttribute('aria-hidden', 'true');
    chevron.style.cssText = 'margin-left:0.5em;font-size:0.75em;display:inline-block;transition:transform 0.2s;vertical-align:middle;';
    chevron.textContent = '▾';
    header.appendChild(chevron);

    header.style.cursor = 'pointer';
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');

    const key = `collapse_${volKey}_${sectionId}`;
    let collapsed = localStorage.getItem(key) === '1';

    const apply = () => {
      items.forEach(item => { item.style.display = collapsed ? 'none' : ''; });
      chevron.style.transform = collapsed ? 'rotate(-90deg)' : '';
      header.setAttribute('aria-expanded', String(!collapsed));
    };

    const expand = () => {
      if (!collapsed) return;
      collapsed = false;
      localStorage.setItem(key, '0');
      apply();
    };

    apply();

    // Expand automatically when the section is targeted via hash navigation
    if (window.location.hash.slice(1) === sectionId) expand();
    window.addEventListener('hashchange', () => {
      if (window.location.hash.slice(1) === sectionId) expand();
    });

    const toggle = () => {
      collapsed = !collapsed;
      localStorage.setItem(key, collapsed ? '1' : '0');
      apply();
    };

    header.addEventListener('click', toggle);
    header.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
  });
});
