/**
 * The pre-paint half of the scroll choreography, as a string for a blocking inline script.
 *
 * It lives in its own module — not beside the observer in components/Reveal.tsx — because that
 * file is `'use client'`, and every export of a client module reaches a Server Component as an
 * opaque client *reference* rather than as its value. Reading this string in the root layout from
 * there threw `ReferenceError: REVEAL_BOOTSTRAP is not defined` at render time, on the server,
 * which took the whole document to a 500. A plain module has no such boundary and both sides can
 * import it.
 *
 * What it does: adds `.js-reveal` to <html> during HTML parsing, before the browser has painted,
 * so content that is about to animate in is hidden from the first frame rather than appearing and
 * then blinking out. It then arms a 2.5 s timer that removes the class again — the failsafe for a
 * session where the observer never mounts, so the page is never left blank behind a script that
 * did not arrive. components/Reveal.tsx cancels that timer when it does mount.
 *
 * Minified by hand and wrapped in try/catch, because it ships in the <head> of every document.
 */
export const REVEAL_BOOTSTRAP = `(function(){try{if(!('IntersectionObserver' in window))return;if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;var d=document.documentElement;d.classList.add('js-reveal');window.__boRevealFailsafe=setTimeout(function(){window.__boRevealOff=1;d.classList.remove('js-reveal')},2500)}catch(e){}})()`;
