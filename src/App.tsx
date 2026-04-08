import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Loader2, CheckCircle2, AlertCircle, Plus, Trash2, Sparkles, Send, Paperclip, X, LogOut, User as UserIcon, Settings, ChevronDown } from "lucide-react";
import axios from "axios";
import { GoogleGenAI, Type } from "@google/genai";
import { auth, signInWithGoogle, onAuthStateChanged, User, db, doc, setDoc, getDoc } from "./firebase";
import { signOut } from "firebase/auth";

// const HUBSPOT_TOKEN = (process.env as any).VITE_HUBSPOT_ACCESS_TOKEN;
// PROXY_URL removed as requested

interface Product {
  objectId: string;
  properties: {
    name: { value: string };
    price: { value: string };
    hs_sku: { value: string };
    description?: { value: string };
  };
}

interface Company {
  id: string;
  properties: {
    name: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    phone?: string;
    ein_number?: string;
    billing_address?: string;
    shipping_address?: string;
    domain?: string;
    sales_tax_id?: string;
    store_category?: string;
    number_of_stores?: string;
    lifecyclestage?: string;
    type?: string;
  };
}

interface Contact {
  id: string;
  properties: {
    firstname: string;
    lastname: string;
    email: string;
    phone?: string;
    jobtitle?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
}

interface HubSpotProperty {
  name: string;
  label: string;
  options?: { label: string; value: string }[];
}

interface LineItem {
  productId: string;
  quantity: number;
  label: string;
  price: number;
  sku: string;
  categoryFilter?: string;
}

const getNameGroup = (name: string) => {
  if (!name) return 'Other';

  if (name.startsWith('Bars XL Blends')) return 'Bars XL Blends';
  if (name.startsWith('Olympos Bars XL Blends')) return 'Bars XL Blends';
  if (name.startsWith('Bars XL')) return 'Bars XL';
  if (name.startsWith('Bliss Bars')) return 'Bliss Bars';
  if (name.startsWith('Kush Bursts')) return 'Kush Bursts';
  if (name.startsWith('Sauce Distillate')) return 'Sauce Distillate';
  if (name.startsWith('Silver Label Carts')) return 'Silver Label Carts';
  if (name.startsWith('Black Label')) return 'Black Label';
  if (name.startsWith('Gold Select')) return 'Gold Select';
  if (name.startsWith('Gold Select Smokes')) return 'Gold Select Smokes';
  if (name.startsWith('Live Resin Reserve')) return 'Live Resin Reserve';
  if (name.startsWith('Dream Pen')) return 'Dream Pen';
  if (name.startsWith('2G Distro Pod')) return 'Distro Pod';
  if (name.startsWith('Sauce Pod Starter Kit')) return 'Sauce Pod Starter Kit';
  if (name.startsWith('Trinity')) return 'Trinity';
  if (name.startsWith('Flower Pod')) return 'Flower Pod';
  if (name.startsWith('Concentrate Pod')) return 'Concentrate Pod';
  if (name.startsWith('Bars Blends Flower')) return 'Bars Blends Flower';
  if (name.startsWith('10x15')) return 'Marketing Materials';
  if (name.startsWith('V1')) return 'Marketing Materials';
  if (name.startsWith('V2')) return 'Marketing Materials';

  return 'Other';
};

export default function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [companyProperties, setCompanyProperties] = useState<HubSpotProperty[]>([]);
  const [contactProperties, setContactProperties] = useState<HubSpotProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenStatus, setTokenStatus] = useState<{configured: boolean, prefix: string | null} | null>(null);
  const [geminiStatus, setGeminiStatus] = useState<{key1: string, key2: string, activeKey: string} | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [testingGemini, setTestingGemini] = useState(false);
  const [aiInput, setAiInput] = useState("");
  const [aiFile, setAiFile] = useState<File | null>(null);
  const [aiPreview, setAiPreview] = useState<string | null>(null);
  const [showAiChat, setShowAiChat] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [dbToken, setDbToken] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showAdminSettings, setShowAdminSettings] = useState(false);
  const [newHubspotToken, setNewHubspotToken] = useState("");
  const [savingToken, setSavingToken] = useState(false);

  const [showAddCompanyModal, setShowAddCompanyModal] = useState(false);
  const [showAddContactModal, setShowAddContactModal] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const isAdmin = user?.email === "umar.tahir@svjbrands.com";

  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    companyName: "",
    companyId: "",
    contactId: "",
    companyEin: "",
    shippingAddress: "",
    billingAddress: "",
    paymentTerms: "Net 30",
  });

  const [lineItems, setLineItems] = useState<LineItem[]>([
    { productId: "", quantity: 0, label: "", price: 0, sku: "", categoryFilter: "" },
  ]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      console.log("[DEBUG] Auth State Changed:", { 
        uid: currentUser?.uid, 
        email: currentUser?.email,
        apiKeySnippet: auth.app.options.apiKey?.substring(0, 5) + "..."
      });
      setUser(currentUser);
      setAuthLoading(false);
      if (currentUser) {
        // Pre-fill user info
        setFormData(prev => ({
          ...prev,
          firstName: currentUser.displayName?.split(' ')[0] || "",
          lastName: currentUser.displayName?.split(' ').slice(1).join(' ') || "",
          email: currentUser.email || ""
        }));
      }
    });

    fetch("/api/health")
      .then(res => res.json())
      .then(data => {
        setTokenStatus({configured: data.tokenConfigured, prefix: data.tokenPrefix});
        if (data.diagnostics && data.diagnostics.gemini) {
          setGeminiStatus(data.diagnostics.gemini);
        }
      })
      .catch(err => console.error("Health check failed:", err));
    
    Promise.all([
      fetchProducts(), 
      fetchCompanies()
    ]).finally(() => setLoading(false));

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (user) {
      fetchPropertyOptions("companies");
      fetchPropertyOptions("contacts");
    }
  }, [user]);

  const saveHubspotToken = async () => {
    if (!newHubspotToken) return;
    setSavingToken(true);
    try {
      await setDoc(doc(db, "config", "hubspot"), {
        token: newHubspotToken,
        updatedAt: new Date().toISOString(),
        updatedBy: user?.email
      });
      alert("HubSpot Token saved successfully to Firestore!");
      setShowAdminSettings(false);
      setNewHubspotToken("");
      // Refresh health check
      const res = await fetch("/api/health");
      const data = await res.json();
      setTokenStatus({configured: data.tokenConfigured, prefix: data.tokenPrefix});
    } catch (err) {
      console.error("Error saving token:", err);
      alert("Failed to save token. Check console for details.");
    } finally {
      setSavingToken(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAiFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setAiPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const testGeminiConnection = async () => {
    if (!user) return;
    setTestingGemini(true);
    try {
      const idToken = await user.getIdToken();
      const response = await fetch("/api/test-gemini", {
        headers: { "Authorization": `Bearer ${idToken}` }
      });
      const result = await response.json();
      if (result.success) {
        alert(`Success! Gemini says: "${result.message}"\n\nDiagnostics:\nSource: ${result.diagnostics.source}\nPrefix: ${result.diagnostics.prefix}...\nSuffix: ...${result.diagnostics.suffix}\nLength: ${result.diagnostics.length}`);
      } else {
        const d = result.diagnostics;
        alert(`Failed: ${result.error}\n\nDiagnostics:\nSource: ${d.source}\nPrefix: ${d.prefix}...\nSuffix: ...${d.suffix}\nLength: ${d.length}`);
      }
    } catch (err: any) {
      alert(`Error testing connection: ${err.message}`);
    } finally {
      setTestingGemini(false);
    }
  };

  const processWithAi = async () => {
    if (!aiInput && !aiFile) return;
    
    setAiLoading(true);
    setError(null);

    try {
      const idToken = await user?.getIdToken();
      
      let imageData = null;
      if (aiFile && aiPreview) {
        imageData = {
          mimeType: aiFile.type,
          data: aiPreview.split(",")[1]
        };
      }

      const response = await fetch("/api/process-ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${idToken}`
        },
        body: JSON.stringify({
          text: aiInput,
          image: imageData
        })
      });

      const result = await response.json();
      if (!response.ok) {
        const error = new Error(result.error || "AI processing failed") as any;
        error.details = result.details;
        error.diagnostics = result.diagnostics;
        throw error;
      }
      
      console.log("AI Result:", result);

      if (result.companyName) {
        const matchedCompany = companies.find(c => 
          c.properties.name.toLowerCase().includes(result.companyName.toLowerCase()) ||
          result.companyName.toLowerCase().includes(c.properties.name.toLowerCase())
        );
        if (matchedCompany) {
          handleInputChange({ target: { name: "companyName", value: matchedCompany.properties.name } } as any);
        }
      }

      if (result.lineItems && result.lineItems.length > 0) {
        const newLineItems: LineItem[] = [];
        
        result.lineItems.forEach((aiItem: any) => {
          const product = products.find(p => 
            p.properties.hs_sku?.value?.toLowerCase() === aiItem.sku.toLowerCase()
          );
          
          if (product) {
            newLineItems.push({
              productId: product.objectId,
              label: product.properties.name?.value || "Unknown",
              price: parseFloat(product.properties.price?.value || "0"),
              sku: product.properties.hs_sku?.value || "",
              quantity: aiItem.quantity,
              categoryFilter: getNameGroup(product.properties.name?.value || "")
            });
          }
        });

        if (newLineItems.length > 0) {
          setLineItems(newLineItems);
        }
      }

      setAiInput("");
      setAiFile(null);
      setAiPreview(null);
      setShowAiChat(false);
    } catch (err: any) {
      console.error("AI Processing error:", err);
      
      let errorMessage = "AI failed to process the request: " + err.message;
      
      // If we have diagnostics from the backend, show them
      try {
        const d = err.diagnostics;
        if (d) {
          errorMessage += `\n\n[Diagnostics] Source: ${d.keySource}, Prefix: ${d.keyPrefix}..., Suffix: ...${d.keySuffix}, Length: ${d.keyLength}`;
          
          if (d.keyPrefix && d.keyPrefix.startsWith("AIzaSyB")) {
            errorMessage += "\n\nNote: You appear to be using a Firebase Browser Key for Gemini. Please ensure the 'Generative Language API' is enabled for this key in Google Cloud Console, or use your 'Default Gemini API Key' instead.";
          }
        }
      } catch (e) {
        // Fallback to original message if parsing fails
      }
      
      setError(errorMessage);
    } finally {
      setAiLoading(false);
    }
  };

  const fetchProducts = async () => {
    try {
      const response = await fetch("/api/products");
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await response.text();
        console.error("Non-JSON response from /api/products:", text);
        throw new Error("Server returned an invalid response (not JSON)");
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to fetch products");
      console.log("Products fetched:", data.objects);
      setProducts(data.objects || []);
    } catch (err: any) {
      console.error("Fetch products error:", err);
      setError(err.message);
    }
  };

  const fetchCompanies = async () => {
    try {
      const response = await fetch("/api/companies");
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await response.text();
        console.error("Non-JSON response from /api/companies:", text);
        throw new Error("Server returned an invalid response (not JSON)");
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to fetch companies");
      console.log("Companies fetched:", data.results);
      setCompanies(data.results || []);
    } catch (err: any) {
      console.error("Fetch companies error:", err);
      setError(err.message);
    }
  };

  const fetchContacts = async (companyId: string) => {
    try {
      const response = await fetch(`/api/contacts/${companyId}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to fetch contacts");
      setContacts(data.results || []);
    } catch (err: any) {
      console.error("Fetch contacts error:", err);
    }
  };

  const fetchPropertyOptions = async (objectType: string) => {
    try {
      const response = await fetch(`/api/hubspot-properties/${objectType}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to fetch property options");
      
      if (objectType === "companies") {
        setCompanyProperties(data.results);
      } else {
        setContactProperties(data.results);
      }
    } catch (err: any) {
      console.error(`Fetch ${objectType} properties error:`, err);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));

    // Pre-fill logic for company selection
    if (name === "companyName" && value) {
      const selectedCompany = companies.find(c => c.properties.name === value);
      if (selectedCompany) {
        const props = selectedCompany.properties;
        const formattedAddress = [props.address, props.city, props.state, props.zip].filter(Boolean).join(", ");
        setFormData(prev => ({
          ...prev,
          companyId: selectedCompany.id,
          phone: props.phone || prev.phone,
          companyEin: props.ein_number || prev.companyEin,
          shippingAddress: props.shipping_address || formattedAddress || prev.shippingAddress,
          billingAddress: props.billing_address || formattedAddress || prev.billingAddress,
        }));
        fetchContacts(selectedCompany.id);
      } else {
        setFormData(prev => ({ ...prev, companyId: "", contactId: "" }));
        setContacts([]);
      }
    }

    // Pre-fill logic for contact selection
    if (name === "contactId" && value) {
      const selectedContact = contacts.find(c => c.id === value);
      if (selectedContact) {
        const props = selectedContact.properties;
        const formattedAddress = [props.address, props.city, props.state, props.zip].filter(Boolean).join(", ");
        setFormData(prev => ({
          ...prev,
          firstName: props.firstname || prev.firstName,
          lastName: props.lastname || prev.lastName,
          email: props.email || prev.email,
          phone: props.phone || prev.phone,
          shippingAddress: formattedAddress || prev.shippingAddress,
          billingAddress: formattedAddress || prev.billingAddress,
        }));
      }
    }
  };

  const handleLineItemChange = (index: number, field: keyof LineItem, value: any) => {
    const newItems = [...lineItems];
    if (field === "productId") {
      const product = products.find((p) => String(p.objectId) === String(value));
      if (product) {
        newItems[index] = {
          ...newItems[index],
          productId: value,
          label: product.properties.name?.value || "Unknown",
          price: parseFloat(product.properties.price?.value || "0"),
          sku: product.properties.hs_sku?.value || "",
        };
      } else {
        newItems[index] = { ...newItems[index], productId: "", label: "", price: 0, sku: "" };
      }
    } else {
      newItems[index] = { ...newItems[index], [field]: value };
    }
    setLineItems(newItems);
  };

  const addLineItem = () => {
    setLineItems([...lineItems, { productId: "", quantity: 0, label: "", price: 0, sku: "", categoryFilter: "" }]);
  };

  const removeLineItem = (index: number) => {
    if (lineItems.length > 1) {
      setLineItems(lineItems.filter((_, i) => i !== index));
    }
  };

  const createCompany = async (properties: any) => {
    setIsCreating(true);
    try {
      const idToken = await user?.getIdToken();
      const response = await fetch("/api/create-company", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${idToken}`
        },
        body: JSON.stringify({ properties })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to create company");
      
      const props = data.properties;
      const formattedAddress = [props.address, props.city, props.state, props.zip].filter(Boolean).join(", ");
      
      // 1. Optimistically update the companies list so it appears in dropdown immediately
      setCompanies(prev => [data, ...prev]);
      
      // 2. Update form data with the new company
      setFormData(prev => ({
        ...prev,
        companyName: props.name,
        companyId: data.id,
        shippingAddress: props.shipping_address || formattedAddress || prev.shippingAddress,
        billingAddress: props.billing_address || formattedAddress || prev.billingAddress,
      }));
      
      // 3. Close modal immediately
      setShowAddCompanyModal(false);
      
      // 4. Background refresh and fetch contacts
      fetchCompanies();
      fetchContacts(data.id);
    } catch (err: any) {
      console.error("Create company error:", err);
      alert(err.message);
    } finally {
      setIsCreating(false);
    }
  };

  const createContact = async (properties: any) => {
    setIsCreating(true);
    try {
      const idToken = await user?.getIdToken();
      const currentCompanyId = formData.companyId;
      
      const response = await fetch("/api/create-contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${idToken}`
        },
        body: JSON.stringify({ properties, companyId: currentCompanyId })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to create contact");
      
      const props = data.properties;
      const formattedAddress = [props.address, props.city, props.state, props.zip].filter(Boolean).join(", ");

      // 1. Optimistically update the contacts list
      setContacts(prev => [data, ...prev]);

      // 2. Update form data with the new contact
      setFormData(prev => ({
        ...prev,
        contactId: data.id,
        firstName: props.firstname,
        lastName: props.lastname,
        email: props.email,
        phone: props.phone || prev.phone,
        shippingAddress: formattedAddress || prev.shippingAddress,
        billingAddress: formattedAddress || prev.billingAddress,
      }));

      // 3. Close modal immediately
      setShowAddContactModal(false);

      // 4. Background refresh
      if (currentCompanyId) {
        fetchContacts(currentCompanyId);
      }
    } catch (err: any) {
      console.error("Create contact error:", err);
      alert(err.message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const validLineItems = lineItems.filter((item) => item.productId && item.quantity > 0);

    if (validLineItems.length === 0) {
      setError("Please add at least one product with a quantity greater than 0.");
      setSubmitting(false);
      return;
    }

    try {
      const idToken = await user?.getIdToken();
      const response = await fetch("/api/submit-order", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${idToken}`
        },
        body: JSON.stringify({ formData, lineItems: validLineItems }),
      });

      const result = await response.json();
      if (!response.ok) {
        const errorMsg = result.details ? `${result.error}: ${result.details}` : (result.error || "Submission failed");
        throw new Error(errorMsg);
      }

      // Save to Firestore (Non-blocking)
      const orderId = `order_${Date.now()}`;
      let totalAmount = 0;
      validLineItems.forEach(item => totalAmount += (item.price || 0) * (item.quantity || 0));
      
      setDoc(doc(db, "orders", orderId), {
        userId: user?.uid,
        companyId: formData.companyId,
        contactId: formData.contactId,
        formData,
        lineItems: validLineItems,
        totalAmount,
        hubspotDealId: result.dealId,
        createdAt: new Date().toISOString()
      }).catch(fsErr => {
        console.warn("Failed to save order to Firestore (but HubSpot succeeded):", fsErr);
      });

      setSubmitted(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="portal-container text-center py-16"
        >
          <CheckCircle2 className="w-16 h-16 text-[#f3efe8] mx-auto mb-6" />
          <h1 className="text-4xl mb-4">Order Submitted</h1>
          <p className="text-muted text-lg mb-8">Our team will contact you soon for the invoice.</p>
          <button onClick={() => window.location.reload()} className="px-8">
            New Order
          </button>
        </motion.div>
      </div>
    );
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#0a0a0b] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user || !user.email?.endsWith("@svjbrands.com")) {
    return (
      <div className="min-h-screen bg-[#0a0a0b] flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full bg-[#141416] p-10 rounded-[32px] border border-[#2a2a2d] shadow-2xl text-center"
        >
          <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-8">
            <Sparkles className="w-10 h-10 text-primary" />
          </div>
          <h1 className="text-3xl font-bold text-[#f5f3ef] mb-4">Wholesale Portal</h1>
          {!user ? (
            <>
              <p className="text-muted mb-10 leading-relaxed">
                Welcome to the SVJ USA Wholesale Portal. Please sign in with your @svjbrands.com account to access the system.
              </p>
              <button 
                onClick={signInWithGoogle}
                className="w-full flex items-center justify-center gap-3 bg-white text-black py-4 rounded-xl font-bold uppercase tracking-widest text-xs hover:bg-[#f5f3ef] transition-all shadow-lg"
              >
                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
                Sign in with Google
              </button>
            </>
          ) : (
            <>
              <p className="text-red-400 mb-6 font-medium">Access Denied</p>
              <p className="text-muted mb-10 leading-relaxed text-sm">
                This portal is restricted to authorized personnel only. Your account ({user.email}) does not have permission to access this system. Please use an @svjbrands.com email.
              </p>
              <button 
                onClick={() => signOut(auth)}
                className="w-full bg-[#2a2a2d] text-white py-4 rounded-xl font-bold uppercase tracking-widest text-xs hover:bg-[#323236] transition-all"
              >
                Sign Out
              </button>
            </>
          )}
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex-1 p-4 md:p-8">
      <div className="max-w-7xl mx-auto flex justify-end mb-4">
        <div className="flex items-center gap-4 bg-[#141416] p-2 pr-4 rounded-full border border-[#2a2a2d]">
          {user.photoURL ? (
            <img src={user.photoURL} className="w-8 h-8 rounded-full border border-[#2a2a2d]" alt={user.displayName || ""} />
          ) : (
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
              <UserIcon className="w-4 h-4 text-primary" />
            </div>
          )}
          <div className="text-left">
            <p className="text-[10px] font-bold text-[#f5f3ef] leading-tight">{user.displayName}</p>
            <p className="text-[9px] text-muted leading-tight">{user.email}</p>
          </div>
          <div className="flex items-center gap-1">
            {isAdmin && (
              <button
                onClick={() => setShowAdminSettings(true)}
                className="p-1.5 text-muted hover:text-primary transition-colors bg-transparent shadow-none"
                title="Admin Settings"
              >
                <Settings className="w-4 h-4" />
              </button>
            )}
            <button 
              onClick={() => signOut(auth)}
              className="p-1.5 text-muted hover:text-red-400 transition-colors bg-transparent shadow-none"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
      {/* Admin Settings Modal */}
      <AnimatePresence>
        {showAdminSettings && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-[#171719] border border-[#2a2a2d] rounded-[32px] shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="p-8 border-b border-[#2a2a2d] flex justify-between items-center bg-[#1c1c1f]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center">
                    <Settings className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-[#f5f3ef]">Admin Settings</h3>
                    <p className="text-[10px] text-muted uppercase tracking-widest">System Configuration</p>
                  </div>
                </div>
                <button onClick={() => setShowAdminSettings(false)} className="text-muted hover:text-white p-2 transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <div className="p-8 space-y-6">
                <div>
                  <label className="block text-xs font-bold text-muted uppercase tracking-widest mb-3">
                    HubSpot Access Token
                  </label>
                  <p className="text-xs text-muted mb-4 leading-relaxed">
                    This token is stored securely in Firestore and used by the backend for all HubSpot API calls.
                  </p>
                  <input
                    type="password"
                    value={newHubspotToken}
                    onChange={(e) => setNewHubspotToken(e.target.value)}
                    placeholder="pat-na1-..."
                    className="w-full px-5 py-3 bg-[#0a0a0b] border border-[#323236] rounded-2xl text-sm focus:border-primary outline-none transition-all placeholder:text-muted/30"
                  />
                </div>
                <button
                  onClick={saveHubspotToken}
                  disabled={savingToken || !newHubspotToken}
                  className="w-full py-4 bg-primary text-black rounded-2xl font-bold uppercase tracking-widest text-xs hover:bg-primary/90 disabled:bg-muted/20 disabled:text-muted/50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-lg shadow-primary/10"
                >
                  {savingToken ? <Loader2 className="w-5 h-5 animate-spin" /> : "Save to Firestore"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="portal-container"
      >
        <header className="mb-10 flex justify-between items-start">
          <div>
            <h1 className="text-4xl mb-2">Wholesale Order Form</h1>
            <p className="text-muted">SVJ Brands — Premium Wholesale Portal</p>
            {tokenStatus && !tokenStatus.configured && (
              <div className="mt-4 p-4 bg-amber-900/20 border border-amber-900/50 rounded-xl flex items-center gap-3 text-amber-200 text-sm">
                <AlertCircle className="w-5 h-5" />
                <p>
                  <strong>HubSpot Token Missing:</strong> Please add your <code>HUBSPOT_ACCESS_TOKEN</code> to the <strong>Secrets</strong> panel in the Settings menu.
                </p>
              </div>
            )}
            {tokenStatus && tokenStatus.configured && (
              <p className="mt-2 text-xs text-green-400/60">
                Connected to HubSpot (Token: {tokenStatus.prefix}...)
              </p>
            )}
            {geminiStatus && (
              <p className="mt-1 text-[10px] text-muted/40 italic">
                Gemini: {geminiStatus.activeKey}
              </p>
            )}
          </div>
          <button 
            type="button"
            onClick={() => setShowAiChat(!showAiChat)}
            className="flex items-center gap-2 bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-all px-6 py-3 rounded-full font-bold uppercase tracking-widest text-xs"
          >
            <Sparkles className="w-4 h-4" />
            AI Order Entry
          </button>
        </header>

        <AnimatePresence>
          {showAiChat && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="mb-10 p-8 bg-[#171719] border border-primary/30 rounded-[32px] shadow-2xl shadow-primary/5"
            >
              <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center">
                    <Sparkles className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-[#f5f3ef]">AI Order Assistant</h3>
                    <p className="text-xs text-muted uppercase tracking-wider">Powered by Gemini</p>
                  </div>
                </div>
                <button type="button" onClick={() => setShowAiChat(false)} className="text-muted hover:text-white p-2">
                  <X className="w-6 h-6" />
                </button>
              </div>
              
              <p className="text-sm text-muted mb-6 leading-relaxed">
                Paste an SMS, email, or upload a photo of a handwritten order. Our AI will automatically identify the company and match products to your HubSpot catalog.
              </p>

              <div className="space-y-6">
                <textarea 
                  className="w-full h-40 bg-[#0a0a0b] border border-[#323236] rounded-2xl p-5 text-sm focus:border-primary outline-none transition-all resize-none leading-relaxed"
                  placeholder="Example: Order for SVJ Brands - 50x BB-01, 20x BBF-05..."
                  value={aiInput}
                  onChange={(e) => setAiInput(e.target.value)}
                />
                
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-3 cursor-pointer bg-[#2a2a2d] hover:bg-[#323236] px-6 py-3 rounded-xl text-sm font-semibold transition-all border border-[#323236]">
                    <Paperclip className="w-5 h-5 text-muted" />
                    {aiFile ? aiFile.name : "Upload Image"}
                    <input type="file" className="hidden" accept="image/*" onChange={handleFileChange} />
                  </label>
                  
                  {aiPreview && (
                    <div className="relative w-14 h-14 rounded-xl overflow-hidden border-2 border-primary/30">
                      <img src={aiPreview} alt="Preview" className="w-full h-full object-cover" />
                      <button 
                        type="button"
                        onClick={() => {setAiFile(null); setAiPreview(null);}}
                        className="absolute top-0 right-0 bg-black/70 p-1 rounded-bl-lg hover:bg-red-500 transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )}

                  <div className="flex-1 flex items-center gap-4">
                    <button
                      type="button"
                      onClick={testGeminiConnection}
                      disabled={testingGemini || aiLoading}
                      className="text-[10px] uppercase tracking-widest font-bold text-muted/40 hover:text-primary transition-colors flex items-center gap-1"
                    >
                      {testingGemini ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                      Test Connection
                    </button>
                  </div>

                  <button 
                    type="button"
                    onClick={processWithAi}
                    disabled={aiLoading || (!aiInput && !aiFile)}
                    className="flex items-center gap-3 bg-primary text-white px-8 py-3 rounded-xl font-bold uppercase tracking-widest text-xs hover:opacity-90 transition-all disabled:opacity-50 shadow-lg shadow-primary/20"
                  >
                    {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Process with AI
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Company Selection - Moved to Top */}
          <section className="bg-[#1a1a1d] p-6 rounded-2xl border border-[#2a2a2d] shadow-xl">
            <h2 className="text-xl mb-6 uppercase tracking-widest text-[#faf7f2]/60 text-sm">Select Company</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label htmlFor="companyName">Company Name</label>
                    <div className="relative group">
                      <select
                        id="companyName"
                        name="companyName"
                        required
                        value={formData.companyName}
                        onChange={handleInputChange}
                        disabled={loading}
                        className="text-lg py-3 pr-12"
                      >
                        <option value="">Select a company...</option>
                        {companies.map((c) => (
                          <option key={c.id} value={c.properties.name}>
                            {c.properties.name}
                          </option>
                        ))}
                      </select>
                      <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-muted group-focus-within:text-primary transition-colors">
                        <ChevronDown className="w-5 h-5" />
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAddCompanyModal(true)}
                    className="p-3 bg-[#2a2a2d] rounded-xl hover:bg-[#3a3a3d] transition-colors mb-[2px] border border-[#323236]"
                    title="Add New Company"
                  >
                    <Plus className="w-6 h-6 text-primary" />
                  </button>
                </div>
                <p className="mt-2 text-xs text-muted italic">Selecting a company will pre-fill known information below.</p>
              </div>

              {formData.companyId && (
                <div className="md:col-span-2">
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <label htmlFor="contactId">Select Contact</label>
                      <div className="relative group">
                        <select
                          id="contactId"
                          name="contactId"
                          value={formData.contactId}
                          onChange={handleInputChange}
                          className="text-lg py-3 pr-12"
                        >
                          <option value="">Select a contact...</option>
                          {contacts.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.properties.firstname} {c.properties.lastname} ({c.properties.email})
                            </option>
                          ))}
                        </select>
                        <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-muted group-focus-within:text-primary transition-colors">
                          <ChevronDown className="w-5 h-5" />
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowAddContactModal(true)}
                      className="p-3 bg-[#2a2a2d] rounded-xl hover:bg-[#3a3a3d] transition-colors mb-[2px] border border-[#323236]"
                      title="Add New Contact"
                    >
                      <Plus className="w-6 h-6 text-primary" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Customer Information */}
          <section>
            <h2 className="text-xl mb-6 uppercase tracking-widest text-[#faf7f2]/60 text-sm">Contact Details</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label htmlFor="firstName">First Name</label>
                <input
                  id="firstName"
                  name="firstName"
                  type="text"
                  required
                  value={formData.firstName}
                  onChange={handleInputChange}
                  placeholder="John"
                  readOnly={!!formData.contactId}
                  className={formData.contactId ? "bg-[#1a1a1d] border-transparent cursor-not-allowed" : ""}
                />
              </div>
              <div>
                <label htmlFor="lastName">Last Name</label>
                <input
                  id="lastName"
                  name="lastName"
                  type="text"
                  required
                  value={formData.lastName}
                  onChange={handleInputChange}
                  placeholder="Doe"
                  readOnly={!!formData.contactId}
                  className={formData.contactId ? "bg-[#1a1a1d] border-transparent cursor-not-allowed" : ""}
                />
              </div>
              <div>
                <label htmlFor="email">Email Address</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  value={formData.email}
                  onChange={handleInputChange}
                  placeholder="john@company.com"
                  readOnly={!!formData.contactId}
                  className={formData.contactId ? "bg-[#1a1a1d] border-transparent cursor-not-allowed" : ""}
                />
              </div>
              <div>
                <label htmlFor="phone">Mobile Phone Number</label>
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  required
                  value={formData.phone}
                  onChange={handleInputChange}
                  placeholder="+1 (555) 000-0000"
                  readOnly={!!formData.contactId}
                  className={formData.contactId ? "bg-[#1a1a1d] border-transparent cursor-not-allowed" : ""}
                />
              </div>
              <div className="md:col-span-2">
                <label htmlFor="companyEin">Company EIN/ID (Optional)</label>
                <input
                  id="companyEin"
                  name="companyEin"
                  type="text"
                  value={formData.companyEin}
                  onChange={handleInputChange}
                  placeholder="12-3456789"
                />
              </div>
            </div>
          </section>

          <hr />

          {/* Logistics */}
          <section>
            <h2 className="text-xl mb-6 uppercase tracking-widest text-[#faf7f2]/60 text-sm">Logistics & Terms</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <label htmlFor="shippingAddress">Shipping Address</label>
                <textarea
                  id="shippingAddress"
                  name="shippingAddress"
                  required
                  value={formData.shippingAddress}
                  onChange={handleInputChange}
                  placeholder="Full shipping address..."
                  rows={3}
                />
              </div>
              <div className="md:col-span-2">
                <label htmlFor="billingAddress">Billing Address</label>
                <textarea
                  id="billingAddress"
                  name="billingAddress"
                  required
                  value={formData.billingAddress}
                  onChange={handleInputChange}
                  placeholder="Full billing address..."
                  rows={3}
                />
              </div>
              <div>
                <label htmlFor="paymentTerms">Payment Terms</label>
                <select
                  id="paymentTerms"
                  name="paymentTerms"
                  value={formData.paymentTerms}
                  onChange={handleInputChange}
                >
                  <option value="Net 30">Net 30</option>
                  <option value="Net 60">Net 60</option>
                  <option value="Due on Receipt">Due on Receipt</option>
                  <option value="Prepaid">Prepaid</option>
                </select>
              </div>
            </div>
          </section>

          <hr />

          {/* Order Items */}
          <section>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl uppercase tracking-widest text-[#faf7f2]/60 text-sm">Order Items</h2>
              <button
                type="button"
                onClick={addLineItem}
                className="flex items-center gap-2 px-4 py-2 text-xs bg-[#2a2a2d] text-[#f5f3ef] hover:bg-[#323236]"
                style={{ minHeight: 'auto' }}
              >
                <Plus className="w-4 h-4" /> Add Product
              </button>
            </div>

            <div className="space-y-4">
              <AnimatePresence initial={false}>
                {lineItems.map((item, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end bg-[#141416]/50 p-4 rounded-xl border border-[#2a2a2d]"
                  >
                    <div className="md:col-span-6">
                      <div className="flex justify-between items-center mb-1">
                        <label className="mb-0">Product (SKU)</label>
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-semibold text-muted uppercase tracking-wider">Filter Category:</span>
                          <select 
                            className="text-sm h-10 py-0 px-4 w-auto bg-[#2a2a2d] border border-[#323236] rounded-lg cursor-pointer hover:bg-[#323236] transition-all focus:ring-2 focus:ring-primary/50 outline-none"
                            value={item.categoryFilter || ""}
                            onChange={(e) => handleLineItemChange(index, "categoryFilter", e.target.value)}
                          >
                            <option value="">All Categories</option>
                            {Array.from(new Set(products.map(p => getNameGroup(p.properties.name?.value || "")))).sort().map((catName: string) => (
                              <option key={catName} value={catName}>{catName}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <select
                        value={item.productId}
                        onChange={(e) => handleLineItemChange(index, "productId", e.target.value)}
                        disabled={loading}
                      >
                        <option value="">Select a product...</option>
                        {(() => {
                          const filtered = products.filter(p => !item.categoryFilter || getNameGroup(p.properties.name?.value || "") === item.categoryFilter);
                          const grouped: { [key: string]: Product[] } = {};
                          
                          filtered.forEach(p => {
                            const catName = getNameGroup(p.properties.name?.value || "");
                            if (!grouped[catName]) {
                              grouped[catName] = [];
                            }
                            grouped[catName].push(p);
                          });

                          const sortedCatNames = Object.keys(grouped).sort();

                          return sortedCatNames.map(catName => (
                            <optgroup key={catName} label={catName}>
                              {grouped[catName].sort((a, b) => (a.properties.hs_sku?.value || "").localeCompare(b.properties.hs_sku?.value || "")).map(p => {
                                const name = p.properties.name?.value || "Unknown Product";
                                const sku = p.properties.hs_sku?.value || "No SKU";
                                const price = p.properties.price?.value || "0.00";
                                return (
                                  <option key={p.objectId} value={String(p.objectId)}>
                                    [{sku}] {name} - ${price}
                                  </option>
                                );
                              })}
                            </optgroup>
                          ));
                        })()}
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <label>Quantity</label>
                      <input
                        type="number"
                        min="0"
                        value={item.quantity === 0 ? "" : item.quantity}
                        onChange={(e) => handleLineItemChange(index, "quantity", e.target.value === "" ? 0 : parseInt(e.target.value) || 0)}
                        placeholder="0"
                      />
                    </div>
                    <div className="md:col-span-3">
                      <label>Subtotal</label>
                      <div className="min-h-[50px] flex items-center px-4 bg-[#171719] border border-[#323236] rounded-[14px] text-[#f5f3ef]">
                        ${(item.price * item.quantity).toFixed(2)}
                      </div>
                    </div>
                    <div className="md:col-span-1 flex justify-center">
                      <button
                        type="button"
                        onClick={() => removeLineItem(index)}
                        className="p-3 text-red-400 hover:text-red-300 bg-transparent shadow-none"
                        style={{ minHeight: 'auto' }}
                        disabled={lineItems.length === 1}
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            <div className="mt-8 flex justify-end">
              <div className="text-right">
                <p className="text-xs uppercase tracking-widest text-muted mb-1">Total Amount</p>
                <p className="text-4xl font-bold">
                  ${lineItems.reduce((acc, item) => acc + item.price * item.quantity, 0).toFixed(2)}
                </p>
              </div>
            </div>
          </section>

          {error && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="p-4 bg-red-900/20 border border-red-900/50 rounded-xl flex items-center gap-3 text-red-200"
            >
              <AlertCircle className="w-5 h-5" />
              <p>{error}</p>
            </motion.div>
          )}

          <button
            type="submit"
            disabled={submitting || loading}
            className="w-full flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Processing Order...
              </>
            ) : (
              "Submit Wholesale Order"
            )}
          </button>
        </form>
      </motion.div>

      <footer className="footer-copyright">
        © SVJ Brands — Wholesale Portal
      </footer>

      <AnimatePresence>
        {showAddCompanyModal && (
          <Modal 
            title="Add New Company" 
            onClose={() => setShowAddCompanyModal(false)}
            loading={isCreating}
          >
            <AddCompanyForm 
              properties={companyProperties} 
              onSubmit={createCompany} 
              onCancel={() => setShowAddCompanyModal(false)}
              isCreating={isCreating}
            />
          </Modal>
        )}

        {showAddContactModal && (
          <Modal 
            title="Add New Contact" 
            onClose={() => setShowAddContactModal(false)}
            loading={isCreating}
          >
            <AddContactForm 
              properties={contactProperties} 
              onSubmit={createContact} 
              onCancel={() => setShowAddContactModal(false)}
              isCreating={isCreating}
              defaultAddress={companies.find(c => c.id === formData.companyId)?.properties}
            />
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}

function Modal({ title, children, onClose, loading }: { title: string, children: React.ReactNode, onClose: () => void, loading?: boolean }) {
  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm cursor-pointer"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-[#1a1a1d] border border-[#2a2a2d] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col cursor-default"
      >
        <div className="p-6 border-b border-[#2a2a2d] flex justify-between items-center">
          <h3 className="text-xl font-bold uppercase tracking-widest text-[#faf7f2]/80">{title}</h3>
          <button onClick={onClose} className="p-2 hover:bg-[#2a2a2d] rounded-lg transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto flex-1">
          {children}
        </div>
      </motion.div>
    </div>
  );
}

function AddCompanyForm({ properties, onSubmit, onCancel, isCreating }: { properties: HubSpotProperty[], onSubmit: (data: any) => void, onCancel: () => void, isCreating: boolean }) {
  const [data, setData] = useState({
    name: "",
    domain: "",
    sales_tax_id: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    store_category: "",
    number_of_stores: "",
    lifecyclestage: "",
    type: ""
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(data);
  };

  const renderSelect = (name: string, label: string) => {
    const prop = properties.find(p => p.name === name);
    return (
      <div>
        <label>{label}</label>
        <div className="relative group">
          <select 
            required 
            value={(data as any)[name]} 
            onChange={(e) => setData(prev => ({ ...prev, [name]: e.target.value }))}
            className="pr-10"
          >
            <option value="">Select {label}...</option>
            {prop?.options?.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-muted group-focus-within:text-primary transition-colors">
            <ChevronDown className="w-4 h-4" />
          </div>
        </div>
      </div>
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <label>Company Name (Required)</label>
          <input required type="text" value={data.name} onChange={e => setData(prev => ({ ...prev, name: e.target.value }))} />
        </div>
        <div>
          <label>Domain Name</label>
          <input type="text" value={data.domain} onChange={e => setData(prev => ({ ...prev, domain: e.target.value }))} />
        </div>
        <div>
          <label>Sales Tax ID</label>
          <input type="text" value={data.sales_tax_id} onChange={e => setData(prev => ({ ...prev, sales_tax_id: e.target.value }))} />
        </div>
        <div className="md:col-span-2">
          <label>Street Address (Required)</label>
          <input required type="text" value={data.address} onChange={e => setData(prev => ({ ...prev, address: e.target.value }))} />
        </div>
        <div>
          <label>City (Required)</label>
          <input required type="text" value={data.city} onChange={e => setData(prev => ({ ...prev, city: e.target.value }))} />
        </div>
        <div>
          <label>State/Region (Required)</label>
          <input required type="text" value={data.state} onChange={e => setData(prev => ({ ...prev, state: e.target.value }))} />
        </div>
        <div>
          <label>Postal Code (Required)</label>
          <input required type="text" value={data.zip} onChange={e => setData(prev => ({ ...prev, zip: e.target.value }))} />
        </div>
        {renderSelect("store_category", "Store Category")}
        {renderSelect("number_of_stores", "Number of Stores")}
        {renderSelect("lifecyclestage", "Lifecycle Stage")}
        {renderSelect("type", "Type")}
      </div>
      <div className="flex justify-end gap-3 mt-8">
        <button type="button" onClick={onCancel} className="bg-transparent border border-[#2a2a2d] hover:bg-[#2a2a2d]">Cancel</button>
        <button type="submit" disabled={isCreating} className="bg-primary text-white px-8">
          {isCreating ? <Loader2 className="w-5 h-5 animate-spin" /> : "Create Company"}
        </button>
      </div>
    </form>
  );
}

function AddContactForm({ properties, onSubmit, onCancel, isCreating, defaultAddress }: { properties: HubSpotProperty[], onSubmit: (data: any) => void, onCancel: () => void, isCreating: boolean, defaultAddress?: any }) {
  const [data, setData] = useState({
    email: "",
    firstname: "",
    lastname: "",
    jobtitle: "",
    phone: "",
    address: defaultAddress?.address || "",
    city: defaultAddress?.city || "",
    state: defaultAddress?.state || "",
    zip: defaultAddress?.zip || "",
    hs_lead_status: ""
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(data);
  };

  const renderSelect = (name: string, label: string) => {
    const prop = properties.find(p => p.name === name);
    return (
      <div>
        <label>{label}</label>
        <div className="relative group">
          <select 
            required 
            value={(data as any)[name]} 
            onChange={(e) => setData(prev => ({ ...prev, [name]: e.target.value }))}
            className="pr-10"
          >
            <option value="">Select {label}...</option>
            {prop?.options?.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-muted group-focus-within:text-primary transition-colors">
            <ChevronDown className="w-4 h-4" />
          </div>
        </div>
      </div>
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <label>Email Address (Required)</label>
          <input required type="email" value={data.email} onChange={e => setData(prev => ({ ...prev, email: e.target.value }))} />
        </div>
        <div>
          <label>First Name (Required)</label>
          <input required type="text" value={data.firstname} onChange={e => setData(prev => ({ ...prev, firstname: e.target.value }))} />
        </div>
        <div>
          <label>Last Name (Required)</label>
          <input required type="text" value={data.lastname} onChange={e => setData(prev => ({ ...prev, lastname: e.target.value }))} />
        </div>
        <div>
          <label>Job Title (Required)</label>
          <input required type="text" value={data.jobtitle} onChange={e => setData(prev => ({ ...prev, jobtitle: e.target.value }))} />
        </div>
        <div>
          <label>Phone Number (Required)</label>
          <input required type="text" value={data.phone} onChange={e => setData(prev => ({ ...prev, phone: e.target.value }))} />
        </div>
        <div className="md:col-span-2">
          <label>Street Address (Required)</label>
          <input required type="text" value={data.address} onChange={e => setData(prev => ({ ...prev, address: e.target.value }))} />
        </div>
        <div>
          <label>City (Required)</label>
          <input required type="text" value={data.city} onChange={e => setData(prev => ({ ...prev, city: e.target.value }))} />
        </div>
        <div>
          <label>State/Region (Required)</label>
          <input required type="text" value={data.state} onChange={e => setData(prev => ({ ...prev, state: e.target.value }))} />
        </div>
        <div>
          <label>Postal Code (Required)</label>
          <input required type="text" value={data.zip} onChange={e => setData(prev => ({ ...prev, zip: e.target.value }))} />
        </div>
        {renderSelect("hs_lead_status", "Lead Status")}
      </div>
      <div className="flex justify-end gap-3 mt-8">
        <button type="button" onClick={onCancel} className="bg-transparent border border-[#2a2a2d] hover:bg-[#2a2a2d]">Cancel</button>
        <button type="submit" disabled={isCreating} className="bg-primary text-white px-8">
          {isCreating ? <Loader2 className="w-5 h-5 animate-spin" /> : "Create Contact"}
        </button>
      </div>
    </form>
  );
}
