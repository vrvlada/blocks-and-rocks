/**
 * BULK MIGRACIJA: stara kolekcija `scores` → nova `leaderboard` (Firestore Admin SDK).
 *
 * Napomena: aplikacija već migrira automatski po korisniku pri logovanju
 * (vidi migrateLegacyScore() u www/app.js). Ova skripta služi SAMO ako želiš
 * jednokratnu bulk migraciju svih korisnika sa servera.
 *
 * Korišćenje:
 *   1. npm i firebase-admin
 *   2. Skini service account JSON iz Firebase Console (Project settings → Service accounts).
 *   3. node tools/migrate-legacy-firestore.js <putanja-do-serviceAccount.json>
 *
 * Skripta je idempotentna: svaki stari rezultat prebacuje samo ako u `leaderboard`
 * ne postoji jednak ili veći rezultat za tog korisnika.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const serviceAccountPath = process.argv[2];
if (!serviceAccountPath) {
  console.error('Koristi: node tools/migrate-legacy-firestore.js <putanja-do-serviceAccount.json>');
  process.exit(1);
}

let admin;
try {
  admin = require('firebase-admin');
} catch (e) {
  console.error('Nedostaje firebase-admin. Pokreni: npm i firebase-admin');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(serviceAccountPath))) });
const db = admin.firestore();

function sanitizeUsername(u) {
  if (typeof u === 'string' && u.length >= 3 && u.length <= 12) return u;
  return 'Igrač';
}
function sanitizeCountry(c) {
  if (typeof c === 'string' && /^[A-Za-z]{2}$/.test(c)) return c.toUpperCase();
  return 'XX';
}

(async () => {
  console.log('Čitam staru kolekciju "scores"...');
  const snap = await db.collection('scores').get();
  console.log('Pronađeno dokumenata:', snap.size);

  let migrated = 0, skipped = 0, failed = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    const score = Number(data && data.score) || 0;
    const uid = doc.id;
    if (!uid || score <= 0) { skipped++; continue; }

    try {
      // Idempotencija: ako već postoji jednak ili viši rezultat u leaderboard
      const cur = await db.collection('leaderboard')
        .where('userId', '==', uid)
        .orderBy('score', 'desc')
        .limit(1)
        .get();
      if (cur.size && Number(cur.docs[0].data().score) >= score) { skipped++; continue; }

      await db.collection('leaderboard').add({
        userId: uid,
        username: sanitizeUsername(data.username),
        score,
        countryCode: sanitizeCountry(data.countryCode),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      migrated++;
      console.log(`✓ ${uid}: ${score} → leaderboard`);
    } catch (err) {
      failed++;
      console.warn(`✗ ${uid}: ${err.message}`);
    }
  }

  console.log(`\nGotovo. Preneto: ${migrated}, preskočeno: ${skipped}, grešaka: ${failed}`);
  process.exit(0);
})();