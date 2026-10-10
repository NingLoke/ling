# Vendored libraries

`firebase-12.19.0.js` — the parts of the [Firebase JS SDK](https://github.com/firebase/firebase-js-sdk) 12.19.0
(Apache-2.0, license headers kept at the end of the file) that the planner uses: app, auth, firestore.
Kept in the repo instead of loading from a CDN so the page (and later the packaged APK / EXE) works offline.

Rebuild (in an empty folder):

```bash
npm install firebase@12.19.0 esbuild@0.25.10
cat > entry.js <<'JS'
export { initializeApp } from "firebase/app";
export {
  getAuth, connectAuthEmulator, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signInWithPopup, GoogleAuthProvider, signOut,
} from "firebase/auth";
export {
  getFirestore, connectFirestoreEmulator, collection, doc, query, where, onSnapshot, runTransaction, serverTimestamp, Timestamp,
} from "firebase/firestore";
JS
npx esbuild entry.js --bundle --format=esm --minify --legal-comments=eof --target=es2020 --outfile=firebase-12.19.0.js
```
