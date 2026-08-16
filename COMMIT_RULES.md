# 📜 Pravila za commit — Blocks & Rocks

Ova pravila obezbeđuju čistu istoriju, lakšu saradnju i manje bugova. Molim prati ih pri svakom commit-u.

---

## 1. Format poruke (Conventional Commits)

```
<tip>(<opcioni opseg>): <kratak opis u imperativu, malim slovima>

<opciono telo — šta i zašto, ne kako>
```

**Tipovi:**
| Tip | Kada ga koristiti |
|-----|-------------------|
| `feat` | nova funkcionalnost (npr. novi power-up, bedž, podešavanje) |
| `fix` | ispravka buga |
| `perf` | poboljšanje performansi bez promene ponašanja |
| `refactor` | izmene koda bez nove funkcionalnosti/bugfix-a |
| `test` | dodavanje/izmena testova |
| `docs` | dokumentacija |
| `style` | formatiranje, razmaci, CSS bez logičke promene |
| `chore` | build, konfiguracija, zavisnosti, release snapshot |
| `build` | izmene build sistema (gradle, capacitor, npm) |

**Opseg (scope)** — opciono, npr.: `game`, `leaderboard`, `i18n`, `effects`, `audio`, `auth`, `android`, `save`.

**Primeri:**
```
feat(game): dodaj undo potez
fix(render): ukloni bljesak kocaka nakon čišćenja reda
feat(i18n): dodaj reduce-motion prevode na 6 jezika
test(gamecore): pokrij granit (3 HP) kao kamen u eksploziji
chore(release): snapshot 2026-08-16
```

**Pravila za opis:**
- Piši na **srpskom** (projekat je srpski), kratko i jasno.
- Počni glagolom u imperativu: „dodaj", „ispravi", „ukloni", „pomeri".
- Bez tačke na kraju naslova; naslov ≤ 72 karaktera.

---

## 2. Šta MORA da prođe pre commit-a

Pre svakog commit-a izvrši (ili se osloni na pre-commit hook):

```bash
npm test          # svi testovi moraju proći (gameCore)
```

Ako menjaš `www/` (bilo koji fajl), obavezno sinhronizuj Android build:
```bash
npm run copy      # ili: npm run sync
```
> **Napomena:** `android/app/src/main/assets/public/` je **build izlaz** i nalazi se u `.gitignore` — nikad ga ne commit-uj ručno; regeneriše se `cap copy`/`cap sync`.

Ako menjaš `.js` module, proveri sintaksu:
```bash
node --check <fajl>
```

---

## 3. Šta se NE commit-uje (tajne i otpad)

Ovo je već pokriveno `.gitignore`, ali za svaki slučaj:
- `users_auth.json` — Firebase Auth dump korisnika (**osetljivo**)
- `serviceAccount*.json`, `*-service-account*.json` — tajni ključevi
- `node_modules/`, `android/**/build/`, `android/app/src/main/assets/public/`
- `.idea/`, `.vscode/`, `*.log`, `Thumbs.db`, `.DS_Store`

> **Izuzetak koji JESTE u redu da se commit-uje:** `android/app/google-services.json` — to je javni Android Firebase config koji se i tako pakujу u APK (isti ključevi su već u `index.html`).

Ako nisi siguran da li je fajl tajna — **ne commit-uj ga** i pitaj.

---

## 4. Radni tok (branch → commit → push)

1. Radi na `main` (solo projekat) ili na `feature/...` grani za veće izmene.
2. Česti, mali commitovi — jedna logička izmena = jedan commit.
3. Pre push-a: `npm test` mora biti zelen.
4. Push: `git push origin main`.

---

## 5. Automatizacija (već podešeno u ovom repou)

- **Pre-commit hook** (`.githooks/pre-commit`) automatski pokreće `npm test` i odbija commit ako testovi padnu.
- **Commit template** (`.gitmessage`) prikazuje podsetnik formata pri `git commit`.
- **npm skripte:** `npm test`, `npm run copy`, `npm run sync`, `npm run build:android`.

Da bi hook i template bili aktivni na novom klonu:
```bash
git config core.hooksPath .githooks
git config commit.template .gitmessage
```
