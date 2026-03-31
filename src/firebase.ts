import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, User } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';
// Import the Firebase configuration if it exists
const configs = import.meta.glob('../firebase-applet-config.json', { eager: true, import: 'default' });
const fileConfig = configs['../firebase-applet-config.json'] as any;

// Only use fileConfig if it actually contains an apiKey
const useFileConfig = fileConfig && fileConfig.apiKey;

const firebaseConfig = useFileConfig ? fileConfig : {
  apiKey: (import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyB_VXl7YUXcQbmmr-9-iFJY4ayWdbaIXN0").trim(),
  authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "gen-lang-client-0125145098.firebaseapp.com").trim(),
  projectId: (import.meta.env.VITE_FIREBASE_PROJECT_ID || "gen-lang-client-0125145098").trim(),
  storageBucket: (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "gen-lang-client-0125145098.firebasestorage.app").trim(),
  messagingSenderId: (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "1063973815235").trim(),
  appId: (import.meta.env.VITE_FIREBASE_APP_ID || "1:1063973815235:web:ba7a4c35fa8a5dc1c3f376").trim(),
  firestoreDatabaseId: (import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID || "ai-studio-f4d77b55-6f5e-42f7-a496-84f9e8a52ad4").trim()
};

// Initialize Firebase SDK (with hardcoded fallbacks for Vercel)
let app: any;
const missingKeys = [];
if (!firebaseConfig.apiKey) missingKeys.push('VITE_FIREBASE_API_KEY');
if (!firebaseConfig.projectId) missingKeys.push('VITE_FIREBASE_PROJECT_ID');
if (!firebaseConfig.authDomain) missingKeys.push('VITE_FIREBASE_AUTH_DOMAIN');

// Debug: Log all VITE_ environment variables (keys and value lengths)
const viteEnv = import.meta.env;
const debugInfo = Object.keys(viteEnv)
  .filter(k => k.startsWith('VITE_'))
  .reduce((acc, key) => {
    acc[key] = { length: String(viteEnv[key]).length, exists: !!viteEnv[key] };
    return acc;
  }, {} as any);
console.log("[DEBUG] VITE_ Environment Status:", debugInfo);

const databaseId = (firebaseConfig && firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId.trim()) || 'ai-studio-f4d77b55-6f5e-42f7-a496-84f9e8a52ad4';

try {
  if (missingKeys.length > 0) {
    console.warn(`Firebase configuration is incomplete. Missing: ${missingKeys.join(', ')}`);
    console.log("[DEBUG] Current firebaseConfig:", { ...firebaseConfig, apiKey: firebaseConfig.apiKey ? "PRESENT" : "MISSING" });
  }
  
  // Log the first 5 chars of the API key to verify it's being picked up correctly (safe for debugging)
  const keySnippet = firebaseConfig.apiKey ? (firebaseConfig.apiKey.substring(0, 5) + "...") : "MISSING";
  console.log(`Initializing Firebase with key starting with: ${keySnippet} (${useFileConfig ? "file" : "env"})`);
  console.log("[DEBUG] Using Firestore Database ID:", databaseId);
  
  // Always use the full config, even if incomplete, to let Firebase throw specific errors
  app = initializeApp(firebaseConfig);
} catch (e) {
  console.error("Error initializing Firebase:", e);
  // Fallback to a minimal initialization to avoid crashing the whole app
  app = initializeApp({ apiKey: "error", projectId: "error", authDomain: "error" });
}

export const auth = getAuth(app);
export const db = getFirestore(app, databaseId);
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
