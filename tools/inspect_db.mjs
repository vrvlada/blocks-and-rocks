import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = 'blocks-and-rocks';
initializeApp({ projectId });
const db = getFirestore();

async function run() {
  console.log('--- USERNAMES ---');
  const uSnaps = await db.collection('usernames').get();
  uSnaps.forEach(doc => console.log(doc.id, '=>', doc.data()));

  console.log('--- USERS ---');
  const userSnaps = await db.collection('users').get();
  userSnaps.forEach(doc => console.log(doc.id, '=>', doc.data()));
}

run().catch(console.error);
