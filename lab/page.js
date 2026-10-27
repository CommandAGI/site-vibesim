/**
 * The page's furniture: the generated clips load only near the viewport and play only in view (never with reduced
 * motion, where the poster stands); the phase rail marks the verb the scroll scene shows.
 */
const still = matchMedia('(prefers-reduced-motion: reduce)');

const videos = [...document.querySelectorAll('video[data-lazy]')];
const watch = new IntersectionObserver(entries => {
    for (const { target: v, isIntersecting } of entries) {
        if (isIntersecting && !still.matches) {
            if (!v.dataset.loaded) {
                for (const s of v.querySelectorAll('source[data-src]')) s.src = s.dataset.src;
                v.load();
                v.dataset.loaded = '1';
            }
            v.play().catch(() => {});
        } else v.pause();
    }
}, { rootMargin: '200px 0px' });
for (const v of videos) watch.observe(v);
still.addEventListener('change', () => { if (still.matches) for (const v of videos) v.pause(); });

const verbs = document.getElementById('verbs');
const rail = [...document.querySelectorAll('[data-rail]')];
if (verbs && rail.length)
    new MutationObserver(() => {
        const phase = ['describe', 'instantiate', 'simulate', 'inspect'].indexOf(verbs.dataset.phase);
        rail.forEach((a, i) => (i === phase ? a.setAttribute('aria-current', 'step') : a.removeAttribute('aria-current')));
    }).observe(verbs, { attributes: true, attributeFilter: ['data-phase'] });
