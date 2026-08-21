/*
 * Blocks & Rocks — deljene pomoćne funkcije (ES modul).
 */

/** HTML-escape korisničkog teksta (anti-XSS) preko DOM textContent mehanizma. */
export function escapeHtml(str){
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/** 
 * Jednostavan DOM Object Pool kako bi se sprečilo "seckanje" usled Garbage Collection-a
 * i stalnog kreiranja novih elemenata usred igranja.
 */
export const DOMPool = {
  pools: {},
  
  /**
   * Uzima element iz bazena ili kreira novi ako je bazen prazan.
   * @param {string} tag Vrsta elementa (npr. 'div')
   * @param {string} className Klasa koja mu se dodeljuje (koristi se i kao ključ za pool)
   */
  acquire(tag, className) {
    if (!this.pools[className]) {
      this.pools[className] = [];
    }
    let el;
    if (this.pools[className].length > 0) {
      el = this.pools[className].pop();
    } else {
      el = document.createElement(tag);
    }
    el.className = className;
    return el;
  },

  /**
   * Vraća element u bazen (sakriva ga sa DOM stabla i briše sadržaj).
   * @param {HTMLElement} el Element koji se vraća
   * @param {string} className Ključ za bazen
   */
  release(el, className) {
    if (!el || !className) return;
    if (el.parentNode) {
      el.parentNode.removeChild(el);
    }
    // Očisti inline stilove i sadržaj kako bi bio spreman za sledeće korišćenje
    el.style.cssText = '';
    el.innerHTML = '';
    
    if (!this.pools[className]) {
      this.pools[className] = [];
    }
    this.pools[className].push(el);
  }
};
