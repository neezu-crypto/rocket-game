import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInAnonymously,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import {
  getDatabase,
  ref,
  get,
  set,
  update,
  push,
  remove,
  onValue,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';
import {
  getFunctions,
  httpsCallable,
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js';

// 로켓 게임 전용 Web App 등록 (자매 저장소들과 같은 프로젝트 soop-stock-market, appId만 별개)
const firebaseConfig = {
  apiKey: 'AIzaSyAZcjQPHphENs-Bb7IfdL2qTtOMhJrRP54',
  authDomain: 'soop-stock-market.firebaseapp.com',
  databaseURL: 'https://soop-stock-market-default-rtdb.firebaseio.com',
  projectId: 'soop-stock-market',
  storageBucket: 'soop-stock-market.firebasestorage.app',
  messagingSenderId: '997788925900',
  appId: '1:997788925900:web:9c92761a2356a301a3a769',
  measurementId: 'G-WYDPLYNHT1',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const functions = getFunctions(app);

window.rgFirebase = {
  ref, get, set, update, push, remove, onValue, serverTimestamp,
  httpsCallable: (name) => httpsCallable(functions, name),
  GoogleAuthProvider,
};
window.rgAuth = auth;
window.rgDb = db;
window.rgUser = null;      // 익명 계정 포함, 현재 인증 세션(방 목록 등 공개 데이터 읽기 권한용)
window.rgRealUser = null;  // 익명이 아닌 실제(Google) 로그인 계정만 — 재화가 걸린 기능은 이 계정만 사용 가능

function signIn() {
  const provider = new GoogleAuthProvider();
  return signInWithPopup(auth, provider).catch((err) => {
    console.error('Google 로그인 실패', err);
    if (err && (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request')) return;
    alert('Google 로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.');
  });
}
window.rgSignIn = signIn;
window.rgSignOut = () => signOut(auth);

// 페이지 접속 시(로딩 동안) 자동으로 익명 로그인 — auth != null 규칙을 만족시켜 로그인
// 전에도 방 목록 등 공개 데이터를 읽을 수 있게 한다. 재화가 걸린 기능(방 생성·참가 등)은
// requireRealAccount가 서버에서 막는다(functions/src/lib/auth.js).
onAuthStateChanged(auth, (user) => {
  window.rgUser = user;
  window.rgRealUser = user && !user.isAnonymous ? user : null;
  document.dispatchEvent(new CustomEvent('rg-auth-changed', { detail: { user, realUser: window.rgRealUser } }));
  if (!user) {
    signInAnonymously(auth).catch((err) => console.error('익명 로그인 실패', err));
  }
});

// Ctrl+Enter 단축키로 어디서든 Google 로그인 팝업(게스트/익명 상태에서도 실계정 전환 가능)
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'Enter' && !window.rgRealUser) {
    e.preventDefault();
    signIn();
  }
});
