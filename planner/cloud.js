// Firebase side of sync: sign-in, pushing pending records, listening for changes. The rules for what to keep
// live in ./sync.js; this file only talks to Firebase. Firebase is loaded on first use, so the planner works
// (offline, on this device only) even when it can't be loaded.
//
// Data layout in Firestore:  users/{uid}/records/{docId}
//   { kind, id, data, deleted, updatedAt, serverAt }   (serverAt = server time of the last write)

import { shouldWrite } from "./sync.js";

const FIREBASE = "./vendor/firebase-12.19.0.js";
const CURSOR_SLACK_MS = 10 * 60 * 1000; // re-read the last 10 minutes on reconnect, in case of out-of-order commits

let fb = null; // the Firebase module
let app = null;
let auth = null;
let db = null;

/** Load Firebase and connect. `config` is the web app config from the Firebase console. */
export async function connect(config, { emulator = false } = {}) {
  if (app) return true;
  fb = await import(FIREBASE);
  app = fb.initializeApp(config);
  auth = fb.getAuth(app);
  db = fb.getFirestore(app);
  if (emulator) {
    fb.connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    fb.connectFirestoreEmulator(db, "127.0.0.1", 8080);
  }
  return true;
}

export const isConnected = () => !!app;

// ---------- account ----------

export function onUser(callback) {
  return fb.onAuthStateChanged(auth, (user) => callback(user ? { uid: user.uid, email: user.email || "", name: user.displayName || "" } : null));
}

export const signIn = (email, password) => fb.signInWithEmailAndPassword(auth, email, password);
export const signUp = (email, password) => fb.createUserWithEmailAndPassword(auth, email, password);
export const resetPassword = (email) => fb.sendPasswordResetEmail(auth, email);
export const signInGoogle = () => fb.signInWithPopup(auth, new fb.GoogleAuthProvider());
export const signOut = () => fb.signOut(auth);

/** Firebase error code -> something a person can act on. */
export function explainError(error) {
  const code = String(error?.code || "");
  const map = {
    "auth/invalid-email": "邮箱格式不对",
    "auth/missing-password": "请输入密码",
    "auth/weak-password": "密码至少要 6 位",
    "auth/email-already-in-use": "这个邮箱已经注册过了，请直接登录",
    "auth/invalid-credential": "邮箱或密码不对",
    "auth/wrong-password": "邮箱或密码不对",
    "auth/user-not-found": "这个邮箱还没注册",
    "auth/too-many-requests": "试得太多次了，请过几分钟再试",
    "auth/network-request-failed": "连不上网络",
    "auth/popup-closed-by-user": "登录窗口被关掉了",
    "auth/popup-blocked": "浏览器挡住了登录窗口，请允许弹出窗口后再试",
    "auth/operation-not-allowed": "这种登录方式还没在 Firebase 里开启（见设置说明）",
    "auth/unauthorized-domain": "这个网址还没加进 Firebase 的授权网域（见设置说明）",
    "permission-denied": "云端拒绝了读写，请检查 Firestore 规则（见设置说明）",
    unavailable: "连不上云端，稍后会自动重试",
  };
  return map[code] || map[code.replace(/^firestore\//, "")] || error?.message || "出了点问题";
}

// ---------- data ----------

const recordsOf = (uid) => fb.collection(db, "users", uid, "records");

const fromDoc = (snap) => {
  const d = snap.data();
  return {
    docId: snap.id,
    kind: d.kind,
    id: d.id,
    data: d.data ?? null,
    deleted: !!d.deleted,
    updatedAt: Number(d.updatedAt),
    serverAt: d.serverAt?.toMillis?.() ?? null,
  };
};

/**
 * Listen for records written since `cursor` (ms, server time). Calls onRecords(list) with each batch and
 * onError(error) if the listener dies. Returns a function that stops listening.
 */
export function listen(uid, cursor, onRecords, onError) {
  const since = fb.Timestamp.fromMillis(Math.max(0, cursor - CURSOR_SLACK_MS));
  const q = fb.query(recordsOf(uid), fb.where("serverAt", ">", since));
  return fb.onSnapshot(
    q,
    (snap) => {
      const list = [];
      for (const change of snap.docChanges()) {
        if (change.type === "removed" || change.doc.metadata.hasPendingWrites) continue;
        list.push(fromDoc(change.doc));
      }
      if (list.length) onRecords(list);
    },
    onError,
  );
}

/**
 * Upload one batch of pending records. Inside a transaction each record is only written if the server
 * doesn't already have a newer version. Returns { pushed, newer }: pushed = records that are now settled
 * (written, or beaten by the server), newer = the server's records that beat ours (to apply locally).
 */
export async function push(uid, batch) {
  const col = recordsOf(uid);
  return fb.runTransaction(db, async (tx) => {
    const refs = batch.map((rec) => fb.doc(col, rec.docId));
    const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
    const newer = [];
    batch.forEach((rec, i) => {
      const server = snaps[i].exists() ? snaps[i].data() : null;
      if (shouldWrite(server, rec)) {
        tx.set(refs[i], {
          kind: rec.kind,
          id: rec.id,
          data: rec.deleted ? null : rec.data,
          deleted: !!rec.deleted,
          updatedAt: rec.updatedAt,
          serverAt: fb.serverTimestamp(),
        });
      } else {
        newer.push(fromDoc(snaps[i]));
      }
    });
    return { pushed: batch, newer };
  });
}
