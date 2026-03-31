import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, User } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';
// Import the Firebase configuration if it exists
// Use import.meta.glob for optional, eager loading of the config file
const configs = import.meta.glob('../firebase-applet-config.json', { eager: true, import: 'default' });
const fileConfig = configs['../firebase-applet-config.json'] as any;

const firebaseConfig = fileConfig || {
  // Fallback to environment variables if the file is missing
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  firestoreDatabaseId: import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID
};

// Initialize Firebase SDK
let app: any;
try {
  if (!firebaseConfig || !firebaseConfig.apiKey) {
    console.warn("Firebase configuration is incomplete. Please check your environment variables.");
    // Initialize with dummy config to prevent top-level crashes
    app = initializeApp({ apiKey: "dummy" });
  } else {
    app = initializeApp(firebaseConfig);
  }
} catch (e) {
  console.error("Error initializing Firebase:", e);
  app = initializeApp({ apiKey: "dummy" });
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
