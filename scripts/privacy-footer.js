/* Add the RINLU privacy link beside existing legal links in the built music client.
   This does not alter authentication, React state, routes or media playback. */
(() => {
  'use strict';
  const privacyPath = '/music/privacy';
  const legalPaths = new Set(['/legal', '/music/legal', '/copyright', '/music/copyright']);

  function attach() {
    if (document.querySelector('[data-rinlu-privacy-footer]')) return true;
    const links = Array.from(document.querySelectorAll('a[href]'));
    const legalLink = links.find((a) => {
      try {
        const url = new URL(a.getAttribute('href'), location.href);
        return url.origin === location.origin && legalPaths.has(url.pathname.replace(/\/$/, ''));
      } catch { return false; }
    });
    const footer = legalLink?.closest('footer,[role="contentinfo"]') || document.querySelector('footer,[role="contentinfo"]');
    if (!legalLink && !footer) return false;

    const link = document.createElement('a');
    link.href = privacyPath;
    link.dataset.rinluPrivacyFooter = 'true';
    const language = document.documentElement.lang.toLowerCase();
    link.textContent = language.startsWith('zh') ? '隐私政策' : 'Privacy Policy';
    link.setAttribute('aria-label', '隐私政策 / Privacy Policy');
    link.style.marginInlineStart = '1em';
    link.style.whiteSpace = 'nowrap';

    if (legalLink?.parentElement) {
      legalLink.insertAdjacentElement('afterend', link);
    } else {
      footer.appendChild(link);
    }
    return true;
  }

  function init() {
    if (attach()) return;
    const observer = new MutationObserver(() => {
      if (attach()) observer.disconnect();
    });
    observer.observe(document.body, {childList: true, subtree: true});
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, {once: true});
  } else {
    init();
  }
})();
