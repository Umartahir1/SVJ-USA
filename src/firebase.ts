import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, User } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';
// Import the Firebase configuration if it exists
const configs = import.meta.glob('../firebase-applet-config.json', { eager: true, import: 'default' });
const fileConfig = configs['../firebase-applet-config.json'] as any;

// Only use fileConfig if it actually contains an apiKey
const useFileConfig = fileConfig && fileConfig.apiKey;

const firebaseConfig = useFileConfig ? fileConfig : {
  apiKey: (import.meta.env.VITE_FIREBASE_API_KEY || "").trim(),
  authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "").trim(),
  projectId: (import.meta.env.VITE_FIREBASE_PROJECT_ID || "").trim(),
  storageBucket: (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "").trim(),
  messagingSenderId: (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "").trim(),
  appId: (import.meta.env.VITE_FIREBASE_APP_ID || "").trim(),
  firestoreDatabaseId: (import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID || "").trim()
};

// Initialize Firebase SDK
let app: any;
const missingKeys = [];
if (!firebaseConfig.apiKey) missingKeys.push('VITE_FIREBASE_API_KEY');
if (!firebaseConfig.projectId) missingKeys.push('VITE_FIREBASE_PROJECT_ID');

// Debug: Log all VITE_ environment variables (keys only)
const viteKeys = Object.keys(import.meta.env).filter(k => k.startsWith('VITE_'));
console.log("[DEBUG] Available VITE_ keys:", viteKeys);

try {
  if (missingKeys.length > 0) {
    console.warn(`Firebase configuration is incomplete. Missing: ${missingKeys.join(', ')}`);
    console.log("[DEBUG] Current firebaseConfig:", { ...firebaseConfig, apiKey: firebaseConfig.apiKey ? "PRESENT" : "MISSING" });
    app = initializeApp({ apiKey: "missing", projectId: "missing" });
  } else {
    // Log the first 5 chars of the API key to verify it's being picked up correctly (safe for debugging)
    const keySnippet = firebaseConfig.apiKey.substring(0, 5) + "...";
    console.log(`Initializing Firebase with key starting with: ${keySnippet} (${useFileConfig ? "file" : "env"})`);
    app = initializeApp(firebaseConfig);
  }
} catch (e) {
  console.error("Error initializing Firebase:", e);
  app = initializeApp({ apiKey: "error", projectId: "error" });
}

export const auth = getAuth(app);
export const db = getFirestore(app, (firebaseConfig && firebaseConfig.firestoreDatabaseId) || '(default)');
export const googleProvider = new GoogleAuthProvider();

export { doc, setDoc, getDoc };

// Auth Helpers
export const signInWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    
    // Sync user profile to Firestore
    await setDoc(doc(db, 'users', user.uid), {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
      lastLogin: new Date().toISOString()
    }, { merge: true });
    
    return user;
  } catch (error) {
    console.error("Google Sign-In Error:", error);
    throw error;
  }
};

export { onAuthStateChanged };
export type { User };
