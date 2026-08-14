# 🧱 Blocks & Rocks

Statička slagalica (8×8): postavljaj komade, čisti linije, izbegavaj bombe 💥 i takmiči se na globalnoj rang listi. Web aplikacija + Android (Capacitor) + Firebase (Auth, Firestore, App Check).

## Brzi start

```bash
npm install        # jednom
npm start          # dev server → http://localhost:8000
npm test           # unit testovi (node --test)
```

## Struktura

| Putanja | Opis |
|---|---|
| `www/` | Izvorni kod aplikacije (HTML/CSS/JS) — **ovde se menja** |
| `www/gameCore.js` | Čista logika igre (bez DOM-a), pokrivena testovima |
| `tests/` | Unit testovi (`npm test`) |
| `firebase/` | Firestore security rules + indeksi |
| `tools/` | Jednokratne skripte (npr. migracija legacy `scores` → `leaderboard`) |
| `android/` | Capacitor Android projekat (generisan — ne edituje se ručno) |

Posle izmena u `www/`: `npx cap sync` (ili ručno iskopiraj fajlove u `android/app/src/main/assets/public/`).

Deploy pravila: `firebase deploy --only firestore:rules,firestore:indexes`

---

## 🔐 Firebase App Check — uputstvo za podešavanje

App Check štiti Firestore od botova i lažnih klijenata (samo prava aplikacija može da piše rezultate). Kod je **već spreman** — ostaje konfiguracija:

### 1. Kreiraj reCAPTCHA v3 ključ
1. Otvori https://www.google.com/recaptcha/admin/create
2. Tip: **reCAPTCHA v3**
3. Domains — dodaj SVE od:
   - `blocks-and-rocks.firebaseapp.com` (Firebase Hosting domen)
   - **`localhost`** ← obavezno! Capacitor Android WebView koristi `https://localhost` kao origin
   - (opciono) tvoj custom domen
4. Sačuvaj **Site Key** (javni) i **Secret Key** (tajni).

### 2. Registruj aplikaciju u Firebase Console
1. Firebase Console → projekat `blocks-and-rocks` → **App Check**
2. Web app → **Register** → reCAPTCHA v3 → upiši **Secret Key**

### 3. Ubaci Site Key u kod
U `www/app.js` (vrh fajla):
```js
const appCheckSiteKey = '6LcTvojKljuč...'; // javni Site Key — sme u kod
```
Site Key je javni identifikator (kao i Firebase apiKey) — nije tajna.

### 4. Lokalni razvoj (debug token)
- Kad je `localhost` u pitanju (van Capacitor aplikacije), kod automatski uključuje debug mod.
- Pri prvom pokretanju (`npm start` → otvori http://localhost:8000) u konzoli se ispiše:
  `App Check debug token: XXXX-XXXX...`
- Registruj ga: Firebase Console → App Check → Apps → **Manage debug tokens** → Add.

### 5. Tek onda uključi ENFORCEMENT ⚠️
1. Prvo deploy-uj aplikaciju sa Site Key-em i sačekaj da klijenti dobiju novu verziju.
2. Proveri metrike: App Check → **Metrics** — vidiš % zahteva sa validnim tokenom.
3. Kad je ~100%: App Check → **APIs** → Cloud Firestore → **Enforce**.

> ⚠️ **Redosled je kritičan:** ako uključiš Enforce PRE nego klijenti imaju Site Key, svi njihovi zahtevi biće odbijeni (`permission-denied`). Aplikacija ima offline queue, pa se rezultati ne gube — ali rang lista neće raditi dok se ne ažurira.

### Android napomena
Aplikacija i u Android WebView-u koristi **web** Firebase SDK, pa važi isti reCAPTCHA v3 provider (Play Integrity nije potreban). Zato `localhost` mora biti registrovan domen u reCAPTCHA konzoli (korak 1).
