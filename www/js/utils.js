/*
 * Blocks & Rocks — deljene pomoćne funkcije (ES modul).
 */

/** HTML-escape korisničkog teksta (anti-XSS) preko DOM textContent mehanizma. */
export function escapeHtml(str){
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
