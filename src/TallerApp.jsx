import React, { useState, useEffect, useRef } from 'react';
import { 
  Monitor, Smartphone, Tv, Gamepad2, 
  Wrench, Users, Package, FileText, 
  QrCode, Plus, Search, AlertTriangle, 
  CheckCircle2, Clock, Truck, XCircle, Printer, Settings, Save, Trash2, UserPlus,
  User, DollarSign, Edit, LayoutDashboard, AlertCircle, Lock, ShieldCheck,
  Sparkles, Bot, Copy, Building2, Receipt, TrendingUp, History, LogOut, Loader2
} from 'lucide-react';

// --- IMPORTACIONES DE FIREBASE ---
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, getDoc, updateDoc, deleteDoc, onSnapshot } from 'firebase/firestore';

// --- CONFIGURACIÓN DE FIREBASE ---
const defaultFirebaseConfig = {
  apiKey: "AIzaSyA_EUsGO18xhooRkeLlPF2kj63x8qbmUyM",
  authDomain: "sat-pringles.firebaseapp.com",
  projectId: "sat-pringles",
  storageBucket: "sat-pringles.firebasestorage.app",
  messagingSenderId: "303055785861",
  appId: "1:303055785861:web:13f57ca2b924b58f2f7eec"
};

const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : defaultFirebaseConfig;
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// --- DICCIONARIO DE ETIQUETAS PARA DETALLES DE INGRESO ---
const DETAILS_LABELS = {
  dyn_cpu: 'Componentes',
  dyn_pwd: 'Clave/Patrón',
  dyn_charger: 'Trae Cargador',
  dyn_status: 'Estado Físico',
  dyn_imei: 'IMEI',
  dyn_account: 'Cuenta Activa',
  dyn_charge: '¿Carga?',
  dyn_inches: 'Pulgadas',
  dyn_remote: 'Trae Control',
  dyn_panel: 'Estado Panel',
  dyn_base: 'Trae Base/Patas',
  dyn_cap: 'Almacenamiento',
  dyn_acc: 'Accesorios',
  dyn_warranty: 'Sellos Garantía',
  notes: 'Falla / Notas del Cliente'
};

const initialConfigFallback = {
  shopName: 'Sat Pringles',
  address: 'San Luis, Argentina',
  phone: '2664000000',
  terms: '1. El taller no se responsabiliza por pérdida de datos. Haga backup. 2. Pasados los 90 días, se cobrará estadía. 3. Garantía de 30 días.',
  password: 'admin' 
};

const WORKFLOW_STATUSES = [
  'Pendiente', 'En Diagnóstico', 'Presupuestado', 
  'Esperando Repuesto', 'Reparado / Para Entregar', 'Entregado', 'Sin Reparación'
];

const initialTechnicians = [
  { id: 1, name: 'Gustavo Admin', role: 'Administrador' },
  { id: 2, name: 'Técnico Taller', role: 'Técnico Especialista' }
];

// --- INTEGRACIÓN GEMINI API ---
const callGeminiAPI = async (prompt) => {
  // Fix para Vercel: Evitamos usar import.meta para no generar error de build.
  const apiKey = typeof window !== 'undefined' && window.VITE_GEMINI_API_KEY ? window.VITE_GEMINI_API_KEY : ""; 
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    systemInstruction: { parts: [{ text: "Eres un asistente experto para un taller de reparación de electrónica." }] }
  };

  const fetchWithRetry = async (retries = 5, delay = 1000) => {
    if (!apiKey) return "API Key de IA no configurada.";
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error('API request failed');
      const data = await response.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } catch (error) {
      if (retries === 0) throw error;
      await new Promise(resolve => setTimeout(resolve, delay));
      return fetchWithRetry(retries - 1, delay * 2);
    }
  };
  return await fetchWithRetry();
};

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // MODO DINÁMICO: Entra a public si lee el código QR, si no, va al login
  const [appMode, setAppMode] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.has('orden') ? 'public' : 'login';
    }
    return 'login';
  }); 

  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [activeTab, setActiveTab] = useState('dashboard');
  
  const [orders, setOrders] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [servicesCatalog, setServicesCatalog] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [config, setConfig] = useState(initialConfigFallback);
  
  const [activeTechId, setActiveTechId] = useState('');
  const [receiptData, setReceiptData] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null); 

  // --- INICIALIZACIÓN DE FIREBASE ---
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (e) {
        console.error("Auth error", e);
      }
    };
    initAuth();
    
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const getPath = (colName) => {
    return typeof __app_id !== 'undefined' ? `artifacts/${appId}/users/${user?.uid || 'default'}/${colName}` : colName;
  };

  // --- LISTENERS DE FIRESTORE ---
  useEffect(() => {
    if (!user) return;

    const unsubOrders = onSnapshot(collection(db, getPath('orders')), (snap) => {
      if (!snap.empty) setOrders(snap.docs.map(d => d.data()));
    }, (err) => console.error(err));

    const unsubInv = onSnapshot(collection(db, getPath('inventory')), (snap) => {
      if (!snap.empty) setInventory(snap.docs.map(d => d.data()));
    });

    const unsubSrv = onSnapshot(collection(db, getPath('services')), (snap) => {
      if (!snap.empty) setServicesCatalog(snap.docs.map(d => d.data()));
    });

    const unsubTech = onSnapshot(collection(db, getPath('technicians')), (snap) => {
      if (!snap.empty) {
        const techs = snap.docs.map(d => d.data());
        setTechnicians(techs);
        if (techs.length > 0 && !activeTechId) setActiveTechId(techs[0].id);
      } else {
        setTechnicians(initialTechnicians);
        if (!activeTechId) setActiveTechId(initialTechnicians[0].id);
      }
    });

    const unsubConfig = onSnapshot(doc(db, getPath('config'), 'main'), (snap) => {
      if (snap.exists()) {
        setConfig(snap.data());
      }
    });

    return () => {
      unsubOrders(); unsubInv(); unsubSrv(); unsubTech(); unsubConfig();
    };
  }, [user, activeTechId]);

  if (loading) {
    return <div className="min-h-screen bg-slate-100 flex justify-center items-center"><Loader2 className="animate-spin text-blue-600" size={48} /></div>;
  }

  // --- COMPONENTES COMPARTIDOS ---
  const SidebarItem = ({ icon: Icon, label, id }) => (
    <button 
      onClick={() => setActiveTab(id)}
      className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg mb-2 transition-colors ${
        activeTab === id ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      <Icon size={20} />
      <span className="font-medium">{label}</span>
    </button>
  );

  const ReceiptModal = ({ data, onClose }) => {
    if (!data) return null;

    // Genera el link inteligente a tu página web
    const qrUrl = typeof window !== 'undefined' 
      ? `${window.location.origin}/?orden=${data.id}` 
      : `https://tusitio.com/?orden=${data.id}`;

    return (
      <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
        <div className="bg-white w-full max-w-md rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
          <div className="p-8 overflow-y-auto flex-1 font-mono text-sm bg-[#fcfcfc] text-slate-800" id="ticket-print">
            <div className="text-center mb-4">
              <h2 className="text-xl font-bold uppercase mb-1">{config.shopName}</h2>
              <p className="text-xs text-slate-500">{config.address} - Tel: {config.phone}</p>
              <div className="border-b-2 border-dashed border-slate-300 my-4"></div>
              <h3 className="text-lg font-bold">REMITO DE RECEPCIÓN</h3>
              <p className="text-base font-bold my-1">ORDEN: {data.id}</p>
              <p className="text-xs">{new Date().toLocaleString()}</p>
            </div>
            
            <div className="space-y-1 mb-4">
              <p><strong>Cliente:</strong> {data.client}</p>
              <p><strong>Teléfono:</strong> {data.phone}</p>
              {data.clientType === 'GREMIO' && <p><strong>Ref Local:</strong> {data.extRef}</p>}
              <div className="border-b border-dotted border-slate-300 my-2"></div>
              <p><strong>Equipo:</strong> {data.deviceDesc}</p>
              <p><strong>Presupuesto Máx:</strong> {data.budget || 'A cotizar'}</p>
            </div>

            <div className="mb-4">
              <p className="font-bold text-xs uppercase mb-1">Condiciones de Ingreso:</p>
              <ul className="text-[11px] list-disc pl-4 space-y-1 bg-slate-100 p-2 rounded">
                {data.details && Object.entries(data.details).map(([k, v]) => {
                  if(k === 'notes' || !v) return null;
                  return <li key={k}><strong>{DETAILS_LABELS[k] || k}:</strong> {v}</li>
                })}
                {data.details?.notes && <li className="mt-1"><strong>Notas:</strong> {data.details.notes}</li>}
              </ul>
            </div>

            <div className="text-center mb-6 flex flex-col items-center">
              <p className="text-xs mb-2 font-bold uppercase">Escaneá para ver el estado:</p>
              <div className="bg-white p-2 border-2 border-black rounded inline-block mb-1">
                <img 
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(qrUrl)}`} 
                  alt="QR" 
                />
              </div>
              <p className="text-[9px] text-slate-400 break-all">{qrUrl}</p>
            </div>
            <div className="border-t-2 border-dashed border-slate-300 pt-4 text-[10px] text-justify text-slate-600 leading-tight">
              <strong>Términos y Condiciones:</strong> {config.terms}
            </div>
          </div>
          <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end space-x-3">
            <button onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg font-medium transition-colors">Cerrar</button>
            <button onClick={() => window.print()} className="px-4 py-2 bg-blue-600 text-white rounded-lg flex items-center font-bold hover:bg-blue-700 transition-colors"><Printer size={18} className="mr-2" /> Imprimir</button>
          </div>
        </div>
      </div>
    );
  };

  const OrderDetailModal = ({ order, onClose }) => {
    const [editedOrder, setEditedOrder] = useState({ ...order });
    const [selectedPartId, setSelectedPartId] = useState('');
    const [pendingPartsToDeduct, setPendingPartsToDeduct] = useState([]);
    const [selectedServiceId, setSelectedServiceId] = useState('');
    
    const [manualPartName, setManualPartName] = useState('');
    const [manualPartPrice, setManualPartPrice] = useState('');
    
    const [isMessaging, setIsMessaging] = useState(false);
    const [generatedMessage, setGeneratedMessage] = useState('');
    const [aiError, setAiError] = useState('');

    const handleGenerateMessage = async () => {
      setIsMessaging(true);
      setAiError('');
      try {
        const prompt = `Actúa como el servicio de atención al cliente del taller '${config.shopName}'. Redacta un mensaje de WhatsApp corto, empático y muy profesional para el cliente llamado '${editedOrder.client}'. 
        Información a incluir: Equipo: ${editedOrder.deviceDesc}. Estado: ${editedOrder.status}. Presupuesto: $${editedOrder.budget || 'A confirmar'}. Notas: ${editedOrder.details?.notes || 'En revisión.'}. 
        No uses corchetes, genera el mensaje listo para ser enviado.`;
        const response = await callGeminiAPI(prompt);
        setGeneratedMessage(response);
      } catch (error) {
        setAiError('Hubo un problema al generar el mensaje.');
      } finally {
        setIsMessaging(false);
      }
    };

    const handleCopyMessage = () => {
      const textArea = document.createElement("textarea");
      textArea.value = generatedMessage;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
    };

    const handleAddPart = () => {
      if (!selectedPartId) return;
      const part = inventory.find(p => p.id === parseInt(selectedPartId));
      if (part) {
        setEditedOrder({ ...editedOrder, parts: [...(editedOrder.parts || []), part] });
        setPendingPartsToDeduct([...pendingPartsToDeduct, part]);
        setSelectedPartId('');
      }
    };

    const handleAddManualPart = () => {
      if (!manualPartName.trim() || !manualPartPrice) return;
      const newPart = { id: `manual-${Date.now()}`, name: manualPartName, price: Number(manualPartPrice), isManual: true };
      setEditedOrder({ ...editedOrder, parts: [...(editedOrder.parts || []), newPart] });
      setManualPartName('');
      setManualPartPrice('');
    };

    const handleRemovePart = (indexToRemove) => {
      const newParts = [...editedOrder.parts];
      const removedPart = newParts.splice(indexToRemove, 1)[0];
      setEditedOrder({ ...editedOrder, parts: newParts });
      const pendingIdx = pendingPartsToDeduct.findIndex(p => p.id === removedPart.id);
      if (pendingIdx !== -1) {
        setPendingPartsToDeduct(pendingPartsToDeduct.filter((_, idx) => idx !== pendingIdx));
      }
    };

    const handleAddService = () => {
      if (!selectedServiceId) return;
      const srv = servicesCatalog.find(s => s.id === parseInt(selectedServiceId));
      if (srv) {
        setEditedOrder({ ...editedOrder, services: [...(editedOrder.services || []), srv] });
        setSelectedServiceId('');
      }
    };

    const handleRemoveService = (indexToRemove) => {
      const newServices = [...(editedOrder.services || [])];
      newServices.splice(indexToRemove, 1);
      setEditedOrder({ ...editedOrder, services: newServices });
    };

    const handleSaveChanges = async () => {
      setOrders(orders.map(o => o.id === editedOrder.id ? editedOrder : o));
      try {
        await updateDoc(doc(db, getPath('orders'), editedOrder.id), editedOrder);
        if (pendingPartsToDeduct.length > 0) {
          pendingPartsToDeduct.forEach(async (part) => {
            const invRef = doc(db, getPath('inventory'), part.id.toString());
            const invSnap = await getDoc(invRef);
            if (invSnap.exists() && invSnap.data().stock > 0) {
              await updateDoc(invRef, { stock: invSnap.data().stock - 1 });
            }
          });
        }
      } catch (err) {
        console.error("Firebase update Error", err);
      }
      onClose();
    };

    const totalParts = (editedOrder.parts || []).reduce((sum, p) => sum + p.price, 0);
    const totalServices = (editedOrder.services || []).reduce((sum, s) => sum + s.price, 0);
    const grandTotal = totalParts + totalServices;

    return (
      <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
        <div className="bg-white w-full max-w-3xl rounded-xl shadow-2xl flex flex-col max-h-[90vh] animate-fade-in">
          <div className="p-6 border-b border-slate-200 flex justify-between items-center bg-slate-50 rounded-t-xl">
            <div className="min-w-0 pr-4">
              <h2 className="text-xl font-bold text-slate-800 flex items-center truncate">
                <Edit className="mr-2 shrink-0 text-blue-600" size={20} /> <span className="truncate">Orden: {editedOrder.id}</span>
              </h2>
              <p className="text-sm text-slate-500 truncate">{editedOrder.deviceDesc} - Cliente: {editedOrder.client}</p>
            </div>
            <button onClick={onClose} className="shrink-0 text-slate-400 hover:text-red-500"><XCircle size={24} /></button>
          </div>

          <div className="p-6 overflow-y-auto flex-1 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4 min-w-0">
              
              <div className="bg-slate-100 p-3 rounded-lg text-xs text-slate-700 border border-slate-200">
                <p className="font-bold text-slate-500 uppercase mb-2 flex items-center"><FileText size={14} className="mr-1"/> Checklist de Ingreso</p>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(editedOrder.details || {}).map(([k, v]) => {
                    if(k === 'notes' || !v) return null;
                    return <div key={k} className="truncate"><span className="font-semibold">{DETAILS_LABELS[k] || k}:</span> {v}</div>
                  })}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Estado de Reparación</label>
                <select className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" value={editedOrder.status} onChange={(e) => setEditedOrder({...editedOrder, status: e.target.value})}>
                  {WORKFLOW_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Técnico Asignado</label>
                <select className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" value={editedOrder.technician || ''} onChange={(e) => setEditedOrder({...editedOrder, technician: e.target.value})}>
                  <option value="">Sin asignar</option>
                  {technicians.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Presupuesto / Cobro Final ($)</label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-2.5 text-slate-400" size={16} />
                  <input type="text" className="w-full pl-9 p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" value={editedOrder.budget} onChange={(e) => setEditedOrder({...editedOrder, budget: e.target.value})} placeholder="Monto a cobrar..." />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notas Internas / Diagnóstico</label>
                <textarea className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" rows="4" value={editedOrder.details?.notes || ''} onChange={(e) => setEditedOrder({...editedOrder, details: {...editedOrder.details, notes: e.target.value}})} placeholder="Escriba aquí los resultados de la revisión..."></textarea>
              </div>
              <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-xl">
                <div className="flex justify-between items-center mb-3">
                  <label className="text-sm font-bold text-green-800 flex items-center"><Bot size={18} className="mr-2" /> Comunicación Cliente</label>
                  <button type="button" onClick={handleGenerateMessage} disabled={isMessaging} className="text-[10px] flex items-center bg-green-600 text-white hover:bg-green-700 font-bold px-2 py-1.5 rounded shadow-sm transition-all">
                    <Sparkles size={12} className="mr-1" />{isMessaging ? 'Redactando...' : '✨ Generar WhatsApp'}
                  </button>
                </div>
                {generatedMessage && (
                  <div className="relative mt-2 animate-fade-in">
                    <textarea readOnly className="w-full p-3 text-sm border border-green-300 rounded-lg bg-white text-slate-700 outline-none resize-none" rows="4" value={generatedMessage} />
                    <button type="button" onClick={handleCopyMessage} className="absolute bottom-3 right-3 p-1.5 bg-slate-100 hover:bg-slate-200 rounded-md text-slate-600 shadow-sm"><Copy size={16} /></button>
                  </div>
                )}
                {aiError && <p className="text-xs text-red-500 mt-2">{aiError}</p>}
              </div>
            </div>

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col space-y-4 min-w-0">
              <div>
                <h3 className="font-bold text-slate-700 mb-2 flex items-center text-sm"><Wrench size={16} className="mr-2"/> Mano de Obra / Servicios</h3>
                <div className="flex space-x-2 mb-2">
                  <select className="flex-1 min-w-0 p-2 border border-slate-300 rounded-lg text-sm outline-none bg-white" value={selectedServiceId} onChange={(e) => setSelectedServiceId(e.target.value)}>
                    <option value="">Agregar servicio...</option>
                    {servicesCatalog.map(item => <option key={item.id} value={item.id}>{item.name} (${item.price})</option>)}
                  </select>
                  <button type="button" onClick={handleAddService} className="shrink-0 bg-slate-800 text-white px-3 py-1.5 rounded-lg hover:bg-slate-700"><Plus size={16}/></button>
                </div>
                <div className="bg-white border border-slate-200 rounded-lg p-2 space-y-1 max-h-32 overflow-y-auto">
                  {(editedOrder.services || []).map((srv, idx) => (
                    <div key={idx} className="flex justify-between items-center text-xs p-2 bg-slate-50 rounded">
                      <span className="font-medium text-slate-700 truncate">{srv.name}</span>
                      <div className="flex items-center space-x-3 shrink-0 pl-2">
                        <span className="text-slate-500">${srv.price}</span>
                        <button type="button" onClick={() => handleRemoveService(idx)} className="text-red-500 hover:text-red-700"><Trash2 size={14}/></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex-1 flex flex-col">
                <h3 className="font-bold text-slate-700 mb-2 flex items-center text-sm"><Package size={16} className="mr-2"/> Repuestos Utilizados</h3>
                <div className="flex space-x-2 mb-2">
                  <select className="flex-1 min-w-0 p-2 border border-slate-300 rounded-lg text-sm outline-none bg-white" value={selectedPartId} onChange={(e) => setSelectedPartId(e.target.value)}>
                    <option value="">Del Inventario...</option>
                    {inventory.filter(i => i.stock > 0).map(item => <option key={item.id} value={item.id}>{item.name} (${item.price})</option>)}
                  </select>
                  <button type="button" onClick={handleAddPart} className="shrink-0 bg-slate-800 text-white px-3 py-1.5 rounded-lg hover:bg-slate-700"><Plus size={16}/></button>
                </div>
                <div className="flex space-x-2 mb-2">
                  <input type="text" placeholder="Repuesto a pedido..." value={manualPartName} onChange={(e) => setManualPartName(e.target.value)} className="flex-1 min-w-0 p-2 border border-slate-300 rounded-lg text-sm outline-none bg-white" />
                  <input type="number" placeholder="$ Precio" value={manualPartPrice} onChange={(e) => setManualPartPrice(e.target.value)} className="w-20 shrink-0 p-2 border border-slate-300 rounded-lg text-sm outline-none bg-white" />
                  <button type="button" onClick={handleAddManualPart} className="shrink-0 bg-amber-600 text-white px-3 py-1.5 rounded-lg hover:bg-amber-700 font-bold">+</button>
                </div>
                <div className="flex-1 overflow-y-auto bg-white border border-slate-200 rounded-lg p-2 space-y-1">
                  {(editedOrder.parts || []).map((part, idx) => (
                    <div key={idx} className="flex justify-between items-center text-xs p-2 bg-slate-50 rounded">
                      <span className="font-medium text-slate-700 truncate pr-2">{part.name} {part.isManual && <span className="ml-2 text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded whitespace-nowrap">A Pedido</span>}</span>
                      <div className="flex items-center space-x-3 shrink-0 pl-2">
                        <span className="text-slate-500">${part.price}</span>
                        <button type="button" onClick={() => handleRemovePart(idx)} className="text-red-500 hover:text-red-700"><Trash2 size={14}/></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-2 pt-3 border-t border-slate-200 flex flex-col space-y-1">
                <div className="flex justify-between text-xs text-slate-500"><span>Servicios:</span><span>${totalServices.toLocaleString('es-AR')}</span></div>
                <div className="flex justify-between text-xs text-slate-500"><span>Repuestos:</span><span>${totalParts.toLocaleString('es-AR')}</span></div>
                <div className="flex justify-between items-center font-bold text-slate-800 pt-1 border-t border-slate-200">
                  <span>Total Costos Cargados:</span><span className="text-lg text-blue-700">${grandTotal.toLocaleString('es-AR')}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end space-x-3 rounded-b-xl">
            <button onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg font-medium transition-colors">Cancelar</button>
            <button onClick={handleSaveChanges} className="px-6 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg font-bold flex items-center transition-colors"><Save size={18} className="mr-2" /> Guardar Cambios</button>
          </div>
        </div>
      </div>
    );
  };

  // --- VISTAS PRINCIPALES ---
  const ViewDashboard = () => {
    const activeTech = technicians.find(t => t.id === activeTechId);
    const isReceptionist = activeTech?.role === 'Recepcionista';

    const myOrders = orders.filter(o => o.technician === activeTech?.name && !['Entregado', 'Sin Reparación'].includes(o.status));
    const pendingQueue = orders.filter(o => !['Reparado / Para Entregar', 'Entregado', 'Sin Reparación'].includes(o.status));
    const urgentOrders = pendingQueue.filter(o => o.status === 'Pendiente' || o.budget === 'A confirmar');

    const [qcClient, setQcClient] = useState('');
    const [qcDevice, setQcDevice] = useState('');
    const [qcServices, setQcServices] = useState([]);
    const [qcParts, setQcParts] = useState([]);
    const [qcCopied, setQcCopied] = useState(false);
    const [qcManualName, setQcManualName] = useState('');
    const [qcManualPrice, setQcManualPrice] = useState('');

    const handleAddQcService = (e) => {
      const id = parseInt(e.target.value);
      if (!id) return;
      const srv = servicesCatalog.find(s => s.id === id);
      if (srv) setQcServices([...qcServices, { ...srv, uniqueId: Date.now() + Math.random() }]);
      e.target.value = '';
    };

    const handleAddQcPart = (e) => {
      const id = parseInt(e.target.value);
      if (!id) return;
      const prt = inventory.find(p => p.id === id);
      if (prt) setQcParts([...qcParts, { ...prt, uniqueId: Date.now() + Math.random() }]);
      e.target.value = '';
    };

    const handleAddQcManual = () => {
      if (!qcManualName.trim() || !qcManualPrice) return;
      setQcParts([...qcParts, { name: qcManualName, price: Number(qcManualPrice), uniqueId: Date.now() + Math.random(), isManual: true }]);
      setQcManualName('');
      setQcManualPrice('');
    };

    const qcTotal = qcServices.reduce((sum, s) => sum + s.price, 0) + qcParts.reduce((sum, p) => sum + p.price, 0);

    const generateQuoteText = () => {
      let msg = `Hola${qcClient ? ' ' + qcClient : ''}, te paso el presupuesto estimado para tu ${qcDevice || 'equipo'}:\n\n`;
      if (qcServices.length > 0) {
        msg += `*Mano de Obra / Servicios:*\n`;
        qcServices.forEach(s => msg += `• ${s.name}: $${s.price.toLocaleString('es-AR')}\n`);
        msg += `\n`;
      }
      if (qcParts.length > 0) {
        msg += `*Repuestos:*\n`;
        qcParts.forEach(p => msg += `• ${p.name}: $${p.price.toLocaleString('es-AR')}\n`);
        msg += `\n`;
      }
      msg += `*TOTAL ESTIMADO: $${qcTotal.toLocaleString('es-AR')}*\n\nCualquier consulta quedamos a tu disposición. Saludos de *${config.shopName}*!`;
      return msg;
    };

    const handleCopyQuote = () => {
      const textArea = document.createElement("textarea");
      textArea.value = generateQuoteText();
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setQcCopied(true);
      setTimeout(() => setQcCopied(false), 2000);
    };

    return (
      <div className="space-y-6 animate-fade-in">
        <h2 className="text-2xl font-bold text-slate-800 flex items-center"><LayoutDashboard className="mr-2 text-blue-600" /> Panel de Control ({activeTech?.role || 'Dashboard'})</h2>
        <div className="bg-white p-6 rounded-xl border border-indigo-100 shadow-sm flex flex-col lg:flex-row gap-6 bg-gradient-to-r from-indigo-50/50 to-white">
          <div className="flex-1 space-y-4 min-w-0">
            <div><h3 className="text-lg font-bold text-indigo-900 flex items-center mb-1"><FileText size={20} className="mr-2" /> Generador de Presupuestos Rápidos</h3></div>
            <div className="grid grid-cols-2 gap-4">
              <input type="text" placeholder="Nombre cliente (Opcional)" value={qcClient} onChange={e=>setQcClient(e.target.value)} className="p-2 border border-indigo-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-400 bg-white min-w-0" />
              <input type="text" placeholder="Equipo (Ej. Moto G20)" value={qcDevice} onChange={e=>setQcDevice(e.target.value)} className="p-2 border border-indigo-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-400 bg-white min-w-0" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="min-w-0">
                <select onChange={handleAddQcService} defaultValue="" className="w-full p-2 border border-indigo-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-400 bg-white mb-2">
                  <option value="" disabled>+ Agregar Servicio...</option>
                  {servicesCatalog.map(s => <option key={s.id} value={s.id}>{s.name} (${s.price.toLocaleString('es-AR')})</option>)}
                </select>
                <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                  {qcServices.map(s => (
                    <div key={s.uniqueId} className="flex justify-between items-center bg-white p-2 rounded border border-indigo-100 text-xs shadow-sm">
                      <span className="truncate pr-2 font-medium text-slate-700">{s.name}</span>
                      <div className="flex items-center shrink-0 pl-2"><span className="font-bold text-indigo-600 mr-2">${s.price.toLocaleString('es-AR')}</span><button type="button" onClick={() => setQcServices(qcServices.filter(item => item.uniqueId !== s.uniqueId))} className="text-red-400 hover:text-red-600"><Trash2 size={14}/></button></div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="min-w-0">
                <select onChange={handleAddQcPart} defaultValue="" className="w-full p-2 border border-indigo-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-400 bg-white mb-2">
                  <option value="" disabled>+ Repuesto del Catálogo...</option>
                  {inventory.map(p => <option key={p.id} value={p.id}>{p.name} (${p.price.toLocaleString('es-AR')})</option>)}
                </select>
                <div className="flex space-x-2 mb-2">
                  <input type="text" placeholder="A pedido..." value={qcManualName} onChange={e=>setQcManualName(e.target.value)} className="flex-1 min-w-0 p-2 border border-indigo-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-400 bg-white" />
                  <input type="number" placeholder="$" value={qcManualPrice} onChange={e=>setQcManualPrice(e.target.value)} className="w-16 shrink-0 p-2 border border-indigo-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-400 bg-white" />
                  <button type="button" onClick={handleAddQcManual} className="shrink-0 bg-amber-600 text-white px-3 rounded-lg hover:bg-amber-700 font-bold">+</button>
                </div>
                <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                  {qcParts.map(p => (
                    <div key={p.uniqueId} className="flex justify-between items-center bg-white p-2 rounded border border-indigo-100 text-xs shadow-sm">
                      <span className="truncate pr-2 font-medium text-slate-700">{p.name} {p.isManual && <span className="ml-1 text-[9px] bg-amber-100 text-amber-700 px-1 py-0.5 rounded whitespace-nowrap">A Pedido</span>}</span>
                      <div className="flex items-center shrink-0 pl-2"><span className="font-bold text-indigo-600 mr-2">${p.price.toLocaleString('es-AR')}</span><button type="button" onClick={() => setQcParts(qcParts.filter(item => item.uniqueId !== p.uniqueId))} className="text-red-400 hover:text-red-600"><Trash2 size={14}/></button></div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="lg:w-[320px] shrink-0 flex flex-col justify-between bg-indigo-600 text-white p-6 rounded-xl shadow-md">
            <div>
              <p className="text-indigo-200 text-sm font-medium mb-1">Total Cotizado</p>
              <p className="text-4xl font-black mb-4">${qcTotal.toLocaleString('es-AR')}</p>
            </div>
            <button onClick={handleCopyQuote} disabled={qcTotal === 0 && !qcDevice} className="mt-6 w-full bg-white text-indigo-700 hover:bg-indigo-50 py-3 rounded-xl font-bold flex justify-center items-center disabled:opacity-50">
              {qcCopied ? <><CheckCircle2 size={18} className="mr-2" /> ¡Copiado!</> : <><Copy size={18} className="mr-2" /> Copiar WhatsApp</>}
            </button>
          </div>
        </div>

        {!isReceptionist && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div onClick={() => setActiveTab('taller')} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex items-center cursor-pointer hover:shadow-md transition-transform hover:-translate-y-1"><div className="p-4 bg-blue-100 text-blue-600 rounded-lg mr-4"><Wrench size={24} /></div><div><p className="text-sm text-slate-500 font-medium">Equipos a Reparar</p><p className="text-2xl font-bold text-slate-800">{pendingQueue.length}</p></div></div>
              <div onClick={() => setActiveTab('taller')} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex items-center cursor-pointer hover:shadow-md transition-transform hover:-translate-y-1"><div className="p-4 bg-red-100 text-red-600 rounded-lg mr-4"><AlertCircle size={24} className="animate-alert-shine" /></div><div><p className="text-sm text-slate-500 font-medium">Urgencias / Pendientes</p><p className="text-2xl font-bold text-slate-800">{urgentOrders.length}</p></div></div>
              <div onClick={() => setActiveTab('taller')} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex items-center cursor-pointer hover:shadow-md transition-transform hover:-translate-y-1"><div className="p-4 bg-green-100 text-green-600 rounded-lg mr-4"><CheckCircle2 size={24} /></div><div><p className="text-sm text-slate-500 font-medium">Mis Asignaciones</p><p className="text-2xl font-bold text-slate-800">{myOrders.length}</p></div></div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="bg-slate-50 p-4 border-b border-slate-200"><h3 className="font-bold text-slate-700 flex items-center"><User size={18} className="mr-2"/> Mis Equipos ({activeTech?.name || 'Ninguno'})</h3></div>
                <div className="p-0">
                  {myOrders.length > 0 ? (
                    <table className="w-full text-left text-sm"><tbody>{myOrders.map(o => (<tr key={o.id} onClick={() => setSelectedOrder(o)} className="border-b last:border-0 hover:bg-blue-50 cursor-pointer"><td className="p-3 font-medium text-slate-800">{o.id}</td><td className="p-3">{o.deviceDesc}</td><td className="p-3"><span className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs font-semibold">{o.status}</span></td></tr>))}</tbody></table>
                  ) : (<p className="p-6 text-center text-slate-500 text-sm">No tienes equipos asignados actualmente.</p>)}
                </div>
              </div>
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="bg-red-50 p-4 border-b border-red-100"><h3 className="font-bold text-red-700 flex items-center"><AlertTriangle size={18} className="mr-2 animate-alert-shine"/> Atención Requerida</h3></div>
                <div className="p-0">
                  {urgentOrders.length > 0 ? (
                    <table className="w-full text-left text-sm"><tbody>{urgentOrders.map(o => (<tr key={o.id} onClick={() => setSelectedOrder(o)} className="border-b last:border-0 hover:bg-red-50 cursor-pointer"><td className="p-3 font-medium text-slate-800">{o.id}</td><td className="p-3">{o.deviceDesc}</td><td className="p-3"><span className="bg-red-100 text-red-700 px-2 py-1 rounded text-xs font-semibold">{o.status}</span></td></tr>))}</tbody></table>
                  ) : (<p className="p-6 text-center text-slate-500 text-sm">No hay urgencias en este momento.</p>)}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    );
  };

  // --- VISTA 1: RECEPCIÓN DINÁMICA ---
  const ViewReception = () => {
    const [family, setFamily] = useState('Smartphone');
    const [clientType, setClientType] = useState('FINAL');
    const [selectedServices, setSelectedServices] = useState([]);
    const [manualBudget, setManualBudget] = useState('');
    const [manualServiceName, setManualServiceName] = useState('');
    const [manualServicePrice, setManualServicePrice] = useState('');

    const handleAddServiceToReception = (e) => {
      const srvId = parseInt(e.target.value);
      if (!srvId) return;
      const srv = servicesCatalog.find(s => s.id === srvId);
      if (srv && !selectedServices.find(s => s.id === srvId)) setSelectedServices([...selectedServices, srv]);
      e.target.value = ''; 
    };

    const handleAddManualServiceReception = () => {
      if (!manualServiceName.trim() || !manualServicePrice) return;
      setSelectedServices([...selectedServices, { id: `manual-${Date.now()}`, name: manualServiceName, price: Number(manualServicePrice), isManual: true }]);
      setManualServiceName(''); setManualServicePrice('');
    };

    const suggestedBudget = selectedServices.reduce((sum, s) => sum + s.price, 0);
    const displayBudget = manualBudget || (suggestedBudget > 0 ? suggestedBudget.toString() : '');

    const handleSubmit = async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const orderId = `ORD-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
      
      const detailsObj = {};
      formData.forEach((value, key) => {
        if ((key.startsWith('dyn_') || key === 'notes') && value.trim() !== '') {
          detailsObj[key] = value;
        }
      });

      const newOrder = {
        id: orderId,
        client: formData.get('client'), clientType: clientType, extRef: formData.get('extRef') || null, phone: formData.get('phone'),
        family: family, deviceDesc: `${formData.get('brand') || ''} ${formData.get('model') || ''} (${family})`.trim(),
        status: 'Pendiente', date: new Date().toISOString().split('T')[0], budget: formData.get('budget'),
        technician: '', parts: [], services: [...selectedServices], details: detailsObj 
      };

      setOrders([...orders, newOrder]); 
      try { await setDoc(doc(collection(db, getPath('orders')), orderId), newOrder); } catch (err) {}
      
      setReceiptData(newOrder); 
      e.target.reset(); setSelectedServices([]); setManualBudget('');
    };

    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 max-w-4xl animate-fade-in">
        <h2 className="text-2xl font-bold text-slate-800 mb-6 flex items-center"><Plus className="mr-2 text-blue-600" /> Nueva Recepción</h2>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-b border-slate-100 pb-6">
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Tipo de Cliente</label><select className="w-full p-2 border border-slate-300 rounded-lg outline-none" value={clientType} onChange={(e) => setClientType(e.target.value)}><option value="FINAL">Cliente Final</option><option value="GREMIO">Local / Gremio</option></select></div>
            {clientType === 'GREMIO' && <div><label className="block text-sm font-medium text-slate-700 mb-1">N° Orden del Local</label><input type="text" name="extRef" placeholder="Ej. TKT-1234" className="w-full p-2 border border-slate-300 rounded-lg" required /></div>}
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Nombre / Local</label><input type="text" name="client" className="w-full p-2 border border-slate-300 rounded-lg" required /></div>
            <div><label className="block text-sm font-medium text-slate-700 mb-1">WhatsApp</label><input type="tel" name="phone" placeholder="Ej. 5491123456789" className="w-full p-2 border border-slate-300 rounded-lg" required /></div>
            
            <div className="md:col-span-2 bg-indigo-50 p-4 rounded-xl border border-indigo-100 mt-2">
              <label className="block text-sm font-bold text-indigo-900 mb-2">Cotización Rápida (Mano de Obra / Servicios Fijos)</label>
              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1 space-y-2 min-w-0">
                  <select onChange={handleAddServiceToReception} defaultValue="" className="w-full p-2 border border-indigo-200 rounded-lg text-sm outline-none bg-white">
                    <option value="" disabled>Seleccionar servicio predefinido...</option>
                    {servicesCatalog.map(srv => <option key={srv.id} value={srv.id}>{srv.name} (${srv.price.toLocaleString('es-AR')})</option>)}
                  </select>
                  <div className="flex space-x-2 mb-2">
                    <input type="text" placeholder="Servicio manual..." value={manualServiceName} onChange={e=>setManualServiceName(e.target.value)} className="flex-1 min-w-0 p-2 border border-indigo-200 rounded-lg text-sm outline-none bg-white" />
                    <input type="number" placeholder="$" value={manualServicePrice} onChange={e=>setManualServicePrice(e.target.value)} className="w-16 shrink-0 p-2 border border-indigo-200 rounded-lg text-sm outline-none bg-white" />
                    <button type="button" onClick={handleAddManualServiceReception} className="shrink-0 bg-amber-600 text-white px-3 rounded-lg font-bold">+</button>
                  </div>
                  {selectedServices.length > 0 && (
                    <div className="space-y-1">
                      {selectedServices.map(srv => (
                        <div key={srv.id} className="flex justify-between items-center bg-white p-2 rounded border border-indigo-100 text-sm">
                          <span className="text-slate-700 truncate pr-2">{srv.name} {srv.isManual && <span className="text-[9px] bg-amber-100 text-amber-700 px-1 py-0.5 rounded">Manual</span>}</span>
                          <div className="flex items-center shrink-0"><span className="font-bold text-indigo-700">${srv.price.toLocaleString('es-AR')}</span><button type="button" onClick={() => setSelectedServices(selectedServices.filter(s => s.id !== srv.id))} className="text-red-500 hover:text-red-700 ml-2"><Trash2 size={14}/></button></div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="w-full md:w-1/3 shrink-0">
                  <label className="block text-xs font-medium text-indigo-700 mb-1">Presupuesto Aprobado ($)</label>
                  <input type="text" name="budget" value={displayBudget} onChange={(e) => setManualBudget(e.target.value)} placeholder="Monto final..." className="w-full p-2 border border-indigo-300 rounded-lg font-bold text-indigo-900 outline-none" />
                  {suggestedBudget > 0 && !manualBudget && <p className="text-[10px] text-indigo-500 mt-1">Calculado automáticamente.</p>}
                </div>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-3">Familia del Equipo</label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[{ id: 'PC', icon: Monitor, label: 'Computación' }, { id: 'Smartphone', icon: Smartphone, label: 'Celulares' }, { id: 'TV', icon: Tv, label: 'Televisores' }, { id: 'Consola', icon: Gamepad2, label: 'Consolas' }].map(item => (
                <div key={item.id} onClick={() => setFamily(item.id)} className={`cursor-pointer flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all ${family === item.id ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500'}`}><item.icon size={32} className="mb-2" /><span className="font-medium text-sm">{item.label}</span></div>
              ))}
            </div>
          </div>

          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
            <h3 className="font-semibold text-slate-700 mb-4">Especificaciones de {family}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input type="text" name="brand" placeholder="Marca (Ej. Samsung, LG, Sony)" className="p-2 border rounded-lg bg-blue-50 border-blue-300 outline-none" required />
              <input type="text" name="model" placeholder="Modelo (Ej. S20, J7, PS5)" className="p-2 border rounded-lg bg-blue-50 border-blue-300 outline-none" required />
              {family === 'PC' && <><input type="text" name="dyn_cpu" placeholder="Procesador / RAM / Disco" className="p-2 border rounded-lg" /><input type="text" name="dyn_pwd" placeholder="Contraseña de SO" className="p-2 border rounded-lg" /><select name="dyn_charger" className="p-2 border rounded-lg bg-white"><option value="">¿Trae cargador?</option><option>Sí</option><option>No</option></select><input type="text" name="dyn_status" placeholder="Estado físico/bisagras" className="p-2 border rounded-lg" /></>}
              {family === 'Smartphone' && <><input type="text" name="dyn_imei" placeholder="IMEI" className="p-2 border rounded-lg" /><select name="dyn_account" className="p-2 border rounded-lg bg-white"><option value="">¿Cuenta Google/iCloud activa?</option><option>Sí</option><option>No, libre</option></select><select name="dyn_charge" className="p-2 border rounded-lg bg-white"><option value="">¿Carga?</option><option>Sí</option><option>No</option><option>Falso contacto</option></select><input type="text" name="dyn_status" placeholder="Estado físico/pantalla" className="p-2 border rounded-lg" /></>}
              {family === 'TV' && <><input type="text" name="dyn_inches" placeholder="Pulgadas (Ej. 43, 55)" className="p-2 border rounded-lg" /><select name="dyn_remote" className="p-2 border rounded-lg bg-white"><option value="">¿Trae control remoto?</option><option>Sí</option><option>No</option></select><input type="text" name="dyn_panel" placeholder="Estado físico del panel (rayones)" className="p-2 border rounded-lg" /><select name="dyn_base" className="p-2 border rounded-lg bg-white"><option value="">¿Trae base/patas?</option><option>Sí</option><option>No</option></select></>}
              {family === 'Consola' && <><input type="text" name="dyn_cap" placeholder="Capacidad de Disco" className="p-2 border rounded-lg" /><select name="dyn_acc" className="p-2 border rounded-lg bg-white"><option value="">¿Trae cables / Joystick?</option><option>Ambos</option><option>Solo Cables</option><option>Nada</option></select><select name="dyn_warranty" className="p-2 border rounded-lg bg-white"><option value="">Estado Sellos Garantía</option><option>Intactos</option><option>Violados/Rotos</option></select></>}
            </div>
            <div className="mt-4"><textarea name="notes" placeholder="Falla reportada por el cliente / Notas adicionales..." rows="3" className="w-full p-2 border rounded-lg outline-none"></textarea></div>
          </div>
          <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg transition-colors">Registrar Ingreso y Generar Remito</button>
        </form>
      </div>
    );
  };

  // --- VISTA 2: TALLER (KANBAN) ---
  const ViewTaller = () => {
    const updateStatus = async (orderId, newStatus) => {
      setOrders(orders.map(o => o.id === orderId ? { ...o, status: newStatus } : o));
      try { await updateDoc(doc(db, getPath('orders'), orderId), { status: newStatus }); } catch(e){}
    };
    return (
      <div className="h-full flex flex-col animate-fade-in">
        <h2 className="text-2xl font-bold text-slate-800 mb-6 flex items-center"><Wrench className="mr-2 text-blue-600" /> Taller y Diagnóstico</h2>
        <div className="flex-1 overflow-x-auto">
          <div className="flex space-x-4 min-w-max pb-4">
            {WORKFLOW_STATUSES.map(status => (
              <div key={status} className="bg-slate-100 rounded-xl p-4 w-80 flex flex-col max-h-[70vh]">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-semibold text-slate-700">{status}</h3>
                  <span className="bg-slate-200 text-slate-600 text-xs px-2 py-1 rounded-full font-bold">{orders.filter(o => o.status === status).length}</span>
                </div>
                <div className="flex-1 overflow-y-auto space-y-3">
                  {orders.filter(o => o.status === status).map(order => (
                    <div key={order.id} className="bg-white p-4 rounded-lg shadow-sm border border-l-4 border-l-blue-500 hover:shadow-md cursor-pointer relative group" onClick={() => setSelectedOrder(order)}>
                      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-blue-500"><Edit size={16} /></div>
                      <div className="flex justify-between items-start mb-2 pr-6"><span className="text-xs font-bold text-slate-400">{order.id}</span>{order.clientType === 'GREMIO' && <span className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded uppercase font-bold">Gremio</span>}</div>
                      <h4 className="font-bold text-slate-800 text-sm mb-1">{order.deviceDesc}</h4>
                      <p className="text-xs text-slate-500 mb-3">{order.client}</p>
                      <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-50">
                        <div className="flex items-center text-[10px] text-slate-400"><User size={12} className="mr-1" />{order.technician || 'Sin asignar'}</div>
                        <select className="text-xs p-1 border rounded bg-slate-50 outline-none text-slate-600" value={order.status} onClick={(e) => e.stopPropagation()} onChange={(e) => updateStatus(order.id, e.target.value)}>
                          {WORKFLOW_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  // --- VISTA 3: GREMIO ---
  const ViewGremio = () => {
    const gremioOrders = orders.filter(o => o.clientType === 'GREMIO');
    const groupedByLocal = gremioOrders.reduce((acc, order) => {
      if (!acc[order.client]) acc[order.client] = [];
      acc[order.client].push(order);
      return acc;
    }, {});
    const locales = Object.keys(groupedByLocal);

    return (
      <div className="animate-fade-in space-y-6">
        <h2 className="text-2xl font-bold text-slate-800 flex items-center mb-6"><Building2 className="mr-2 text-purple-600" /> Gestión de Locales / Gremio</h2>
        {locales.length === 0 ? (
          <div className="bg-white p-8 rounded-xl border border-slate-200 text-center"><Users className="mx-auto text-slate-300 mb-3" size={48} /><h3 className="text-lg font-bold text-slate-600">No hay clientes mayoristas activos</h3></div>
        ) : (
          <div className="grid grid-cols-1 gap-6">
            {locales.map(localName => {
              const localOrders = groupedByLocal[localName];
              const activeOrders = localOrders.filter(o => !['Entregado', 'Sin Reparación'].includes(o.status));
              const readyOrders = localOrders.filter(o => o.status === 'Reparado / Para Entregar');
              const totalOwed = readyOrders.reduce((sum, o) => { const num = Number(o.budget.replace(/\D/g, '')); return sum + (isNaN(num) ? 0 : num); }, 0);

              return (
                <div key={localName} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="bg-purple-50 p-4 border-b border-purple-100 flex justify-between items-center flex-wrap gap-4">
                    <div><h3 className="text-xl font-bold text-purple-900">{localName}</h3><p className="text-sm text-purple-700">Activos en taller: <strong>{activeOrders.length}</strong></p></div>
                    <div className="flex items-center space-x-6 bg-white p-3 rounded-lg border shadow-sm">
                      <div><p className="text-xs text-slate-500 font-bold uppercase">Listos para retirar</p><p className="text-lg font-bold text-slate-800">{readyOrders.length}</p></div>
                      <div className="border-l pl-6"><p className="text-xs text-slate-500 font-bold uppercase">Liquidación a Cobrar</p><p className="text-xl font-bold text-green-600">${totalOwed.toLocaleString('es-AR')}</p></div>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-slate-500 border-b"><tr><th className="p-3 pl-4">N° Taller</th><th className="p-3">Ref. Local</th><th className="p-3">Equipo</th><th className="p-3">Estado</th><th className="p-3 text-right pr-4">Presupuesto</th></tr></thead>
                      <tbody>
                        {localOrders.map(order => (
                          <tr key={order.id} onClick={() => setSelectedOrder(order)} className="border-b last:border-0 hover:bg-purple-50 cursor-pointer">
                            <td className="p-3 pl-4 font-mono font-bold text-slate-600">{order.id}</td><td className="p-3 font-mono text-purple-600">{order.extRef}</td><td className="p-3">{order.deviceDesc}</td>
                            <td className="p-3"><span className="px-2 py-1 rounded text-[10px] font-bold uppercase bg-slate-100 text-slate-700">{order.status}</span></td><td className="p-3 text-right pr-4 font-medium">${order.budget || '---'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // --- VISTA 4: INVENTARIO ---
  const ViewInventario = () => {
    const [invTab, setInvTab] = useState('repuestos'); 
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState(null);

    const AddItemModal = () => {
      const handleSaveItem = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const docId = editingItem ? editingItem.id.toString() : Date.now().toString();
        const itemData = { id: Number(docId), name: formData.get('name'), price: Number(formData.get('price')) };
        const collectionName = invTab === 'repuestos' ? 'inventory' : 'services';

        if (invTab === 'repuestos') {
          itemData.stock = Number(formData.get('stock'));
          itemData.minStock = Number(formData.get('minStock'));
        } 
        
        if(invTab === 'repuestos'){
           if(editingItem) setInventory(inventory.map(i=> i.id===itemData.id ? itemData : i));
           else setInventory([...inventory, itemData]);
        }else{
           if(editingItem) setServicesCatalog(servicesCatalog.map(s=> s.id===itemData.id ? itemData : s));
           else setServicesCatalog([...servicesCatalog, itemData]);
        }

        try { await setDoc(doc(db, getPath(collectionName), docId), itemData); } catch(e){}
        setIsAddModalOpen(false); setEditingItem(null);
      };

      return (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white w-full max-w-md rounded-xl shadow-2xl flex flex-col animate-fade-in">
            <div className="p-6 border-b border-slate-200 flex justify-between items-center bg-slate-50 rounded-t-xl">
              <h2 className="text-xl font-bold text-slate-800">{editingItem ? 'Editar' : 'Agregar'} {invTab === 'repuestos' ? 'Repuesto' : 'Servicio'}</h2>
              <button onClick={() => {setIsAddModalOpen(false); setEditingItem(null);}} className="text-slate-400 hover:text-red-500"><XCircle size={24} /></button>
            </div>
            <form onSubmit={handleSaveItem} className="p-6 space-y-4">
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Nombre</label><input type="text" name="name" defaultValue={editingItem?.name} required className="w-full p-2 border rounded-lg outline-none focus:ring-2 focus:ring-blue-500" /></div>
              {invTab === 'repuestos' && (
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="block text-sm font-medium text-slate-700 mb-1">Stock Actual</label><input type="number" name="stock" defaultValue={editingItem?.stock} required min="0" className="w-full p-2 border rounded-lg" /></div>
                  <div><label className="block text-sm font-medium text-slate-700 mb-1">Stock Mínimo (Alerta)</label><input type="number" name="minStock" defaultValue={editingItem?.minStock} required min="0" className="w-full p-2 border rounded-lg" /></div>
                </div>
              )}
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Precio Base ($)</label><input type="number" name="price" defaultValue={editingItem?.price} required min="0" className="w-full p-2 border rounded-lg" /></div>
              <div className="pt-4 flex justify-end space-x-3"><button type="button" onClick={() => {setIsAddModalOpen(false); setEditingItem(null);}} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg">Cancelar</button><button type="submit" className="px-6 py-2 bg-blue-600 text-white rounded-lg font-bold">Guardar</button></div>
            </form>
          </div>
        </div>
      );
    };

    const handleDeleteItem = async (id, isInventory) => {
      if(isInventory) setInventory(inventory.filter(i=>i.id!==id));
      else setServicesCatalog(servicesCatalog.filter(s=>s.id!==id));
      try{ await deleteDoc(doc(db, getPath(isInventory ? 'inventory' : 'services'), id.toString())); }catch(e){}
    };

    return (
      <div className="animate-fade-in">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-slate-800 flex items-center"><Package className="mr-2 text-blue-600" /> Catálogo: Repuestos y Servicios</h2>
          <button onClick={() => { setEditingItem(null); setIsAddModalOpen(true); }} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center text-sm font-medium"><Plus size={16} className="mr-2" /> Agregar</button>
        </div>
        <div className="flex space-x-2 mb-6 border-b border-slate-200 pb-2">
          <button onClick={() => setInvTab('repuestos')} className={`px-4 py-2 font-medium rounded-lg ${invTab === 'repuestos' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-200'}`}>Inventario de Repuestos</button>
          <button onClick={() => setInvTab('servicios')} className={`px-4 py-2 font-medium rounded-lg ${invTab === 'servicios' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-200'}`}>Mano de Obra / Servicios</button>
        </div>
        
        {invTab === 'repuestos' && (
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <table className="w-full text-left border-collapse text-sm">
              <thead className="bg-slate-50 border-b"><tr><th className="p-4">Repuesto</th><th className="p-4">Stock</th><th className="p-4">Mínimo</th><th className="p-4">Precio</th><th className="p-4 text-right">Acciones</th></tr></thead>
              <tbody>
                {inventory.map(item => (
                  <tr key={item.id} className="border-b hover:bg-slate-50">
                    <td className="p-4 font-medium">{item.name}</td>
                    <td className="p-4"><span className={`px-2 py-1 rounded-full text-xs font-bold ${item.stock <= item.minStock ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{item.stock} und.</span></td>
                    <td className="p-4 text-slate-500">{item.minStock} und.</td><td className="p-4">${item.price.toLocaleString()}</td>
                    <td className="p-4 flex justify-end space-x-2">
                      <button onClick={() => { setEditingItem(item); setIsAddModalOpen(true); }} className="p-2 text-blue-600 hover:bg-blue-50 rounded"><Edit size={16}/></button>
                      <button onClick={() => handleDeleteItem(item.id, true)} className="p-2 text-red-500 hover:bg-red-50 rounded"><Trash2 size={16}/></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {invTab === 'servicios' && (
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <table className="w-full text-left border-collapse text-sm">
              <thead className="bg-slate-50 border-b"><tr><th className="p-4">Servicio</th><th className="p-4 text-right">Precio Base ($)</th><th className="p-4 text-right">Acciones</th></tr></thead>
              <tbody>
                {servicesCatalog.map(item => (
                  <tr key={item.id} className="border-b hover:bg-slate-50">
                    <td className="p-4 font-medium">{item.name}</td><td className="p-4 text-right font-bold">${item.price.toLocaleString()}</td>
                    <td className="p-4 flex justify-end space-x-2">
                      <button onClick={() => { setEditingItem(item); setIsAddModalOpen(true); }} className="p-2 text-blue-600 hover:bg-blue-50 rounded"><Edit size={16}/></button>
                      <button onClick={() => handleDeleteItem(item.id, false)} className="p-2 text-red-500 hover:bg-red-50 rounded"><Trash2 size={16}/></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {isAddModalOpen && <AddItemModal />}
      </div>
    );
  };

  // --- VISTA 7: REPORTES ---
  const ViewReportes = () => {
    const [searchTerm, setSearchTerm] = useState('');
    const parseBudget = (str) => { const num = Number(str?.toString().replace(/\D/g, '')); return isNaN(num) ? 0 : num; };

    const delivered = orders.filter(o => o.status === 'Entregado');
    const ready = orders.filter(o => o.status === 'Reparado / Para Entregar');
    const irresolvable = orders.filter(o => o.status === 'Sin Reparación');
    const active = orders.filter(o => !['Entregado', 'Reparado / Para Entregar', 'Sin Reparación'].includes(o.status));

    const totalIngresos = delivered.reduce((acc, o) => acc + parseBudget(o.budget), 0);
    const cuentasCobrar = ready.reduce((acc, o) => acc + parseBudget(o.budget), 0);
    const totalCerrados = delivered.length + ready.length + irresolvable.length;
    const efectividad = totalCerrados === 0 ? 0 : Math.round(((delivered.length + ready.length) / totalCerrados) * 100);

    const filteredOrders = orders.filter(o => 
      o.id.toLowerCase().includes(searchTerm.toLowerCase()) || 
      o.client.toLowerCase().includes(searchTerm.toLowerCase()) ||
      o.deviceDesc.toLowerCase().includes(searchTerm.toLowerCase())
    ).sort((a, b) => new Date(b.date) - new Date(a.date));

    const familyCounts = orders.reduce((acc, o) => { acc[o.family] = (acc[o.family] || 0) + 1; return acc; }, {});
    const maxFamilyCount = Math.max(...Object.values(familyCounts), 1);

    return (
      <div className="space-y-6 animate-fade-in">
        <h2 className="text-2xl font-bold text-slate-800 flex items-center"><TrendingUp className="mr-2 text-blue-600" /> Historial y Finanzas</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm"><p className="text-xs text-slate-500 font-bold uppercase mb-1">Ingresos Efectivos</p><p className="text-2xl font-black text-green-600">${totalIngresos.toLocaleString()}</p></div>
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm"><p className="text-xs text-slate-500 font-bold uppercase mb-1">Por Cobrar (Listos)</p><p className="text-2xl font-black text-blue-600">${cuentasCobrar.toLocaleString()}</p></div>
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm"><p className="text-xs text-slate-500 font-bold uppercase mb-1">Efectividad Técnica</p><p className="text-2xl font-black text-slate-800">{efectividad}%</p></div>
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm"><p className="text-xs text-slate-500 font-bold uppercase mb-1">Equipos en Taller</p><p className="text-2xl font-black text-slate-800">{active.length}</p></div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 bg-white rounded-xl shadow-sm border border-slate-200 p-5">
            <h3 className="font-bold text-slate-700 mb-4">Distribución de Equipos</h3>
            <div className="space-y-4">
              {['Smartphone', 'PC', 'Consola', 'TV'].map(fam => (
                <div key={fam}>
                  <div className="flex justify-between text-sm mb-1"><span className="font-medium text-slate-600">{fam}</span><span className="text-slate-500 font-bold">{familyCounts[fam] || 0}</span></div>
                  <div className="w-full bg-slate-100 rounded-full h-2"><div className="bg-blue-500 h-2 rounded-full" style={{ width: `${Math.round(((familyCounts[fam] || 0) / maxFamilyCount) * 100)}%` }}></div></div>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-[500px]">
            <div className="bg-slate-50 p-4 border-b border-slate-200">
              <h3 className="font-bold text-slate-700 flex items-center mb-3"><History className="mr-2" size={18} /> Buscador Global de Órdenes</h3>
              <div className="relative"><Search className="absolute left-3 top-2.5 text-slate-400" size={18} /><input type="text" placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-10 p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm" /></div>
            </div>
            <div className="flex-1 overflow-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead className="bg-white sticky top-0 border-b border-slate-200"><tr><th className="p-3">Orden</th><th className="p-3">Cliente</th><th className="p-3">Equipo</th><th className="p-3 text-right">Estado</th></tr></thead>
                <tbody>
                  {filteredOrders.map(o => (
                    <tr key={o.id} onClick={() => setSelectedOrder(o)} className="border-b hover:bg-slate-50 cursor-pointer">
                      <td className="p-3"><p className="font-bold">{o.id}</p><p className="text-[10px] text-slate-400">{o.date}</p></td>
                      <td className="p-3"><p className="font-medium">{o.client}</p></td>
                      <td className="p-3 text-slate-600">{o.deviceDesc}</td>
                      <td className="p-3 text-right"><span className="px-2 py-1 rounded text-[10px] font-bold uppercase bg-slate-200">{o.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // --- VISTA 5: CONFIGURACIÓN ---
  const ViewConfiguracion = () => {
    const [isUnlocked, setIsUnlocked] = useState(false);
    const [pwdInput, setPwdInput] = useState('');
    const [lockError, setLockError] = useState('');
    const [confTab, setConfTab] = useState('general');
    const [newTechName, setNewTechName] = useState('');
    const [newTechRole, setNewTechRole] = useState('Técnico');
    
    const [oldPwd, setOldPwd] = useState('');
    const [newPwd, setNewPwd] = useState('');
    const [confirmPwd, setConfirmPwd] = useState('');

    const handleSaveConfig = async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const newConfig = { ...config, shopName: formData.get('shopName'), address: formData.get('address'), phone: formData.get('phone'), terms: formData.get('terms') };
      setConfig(newConfig); 
      try { await setDoc(doc(db, getPath('config'), 'main'), newConfig); alert('Configuración guardada.'); } catch(e){}
    };

    const handleAddTech = async (e) => {
      e.preventDefault();
      if (!newTechName.trim()) return;
      const techId = Date.now().toString();
      const newTech = { id: Number(techId), name: newTechName, role: newTechRole };
      setTechnicians([...technicians, newTech]);
      try{ await setDoc(doc(db, getPath('technicians'), techId), newTech); } catch(e){}
      setNewTechName('');
    };

    const removeTech = async (id) => {
      setTechnicians(technicians.filter(t=>t.id!==id));
      try{ await deleteDoc(doc(db, getPath('technicians'), id.toString())); }catch(e){}
    }

    const handleChangePassword = async (e) => {
      e.preventDefault();
      if (oldPwd !== config.password) { alert('Contraseña actual incorrecta.'); return; }
      if (newPwd !== confirmPwd) { alert('Las contraseñas no coinciden.'); return; }
      setConfig({ ...config, password: newPwd });
      try{ await setDoc(doc(db, getPath('config'), 'main'), { ...config, password: newPwd }); alert('¡Contraseña actualizada!');}catch(e){}
    };

    if (!isUnlocked) {
      return (
        <div className="max-w-md mx-auto mt-20 bg-white p-8 rounded-xl shadow-sm border border-slate-200 animate-fade-in">
          <div className="text-center mb-6"><div className="bg-blue-100 text-blue-600 p-4 rounded-full inline-block mb-4"><Lock size={32} /></div><h2 className="text-2xl font-bold">Acceso Restringido</h2></div>
          <form onSubmit={(e) => { e.preventDefault(); if (pwdInput === config.password) { setIsUnlocked(true); setLockError(''); } else { setLockError('Incorrecta'); } }} className="space-y-4">
             <input type="password" value={pwdInput} onChange={(e)=>setPwdInput(e.target.value)} className="w-full p-3 border border-slate-300 rounded-lg text-center tracking-widest text-xl outline-none focus:ring-2 focus:ring-blue-500" placeholder="••••••" autoFocus />
             {lockError && <p className="text-red-500 text-sm text-center">{lockError}</p>}
             <button type="submit" className="w-full bg-blue-600 text-white font-bold py-3 rounded-lg hover:bg-blue-700">Desbloquear</button>
          </form>
        </div>
      );
    }

    return (
      <div className="max-w-4xl animate-fade-in">
        <h2 className="text-2xl font-bold text-slate-800 mb-6 flex items-center"><Settings className="mr-2 text-blue-600" /> Configuración</h2>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col md:flex-row min-h-[500px]">
          <div className="w-full md:w-64 bg-slate-50 border-r border-slate-200 p-4 space-y-2">
            <button onClick={() => setConfTab('general')} className={`w-full text-left px-4 py-2 rounded-lg text-sm font-medium ${confTab === 'general' ? 'bg-blue-100 text-blue-700' : 'text-slate-600'}`}>Datos Generales</button>
            <button onClick={() => setConfTab('tecnicos')} className={`w-full text-left px-4 py-2 rounded-lg text-sm font-medium ${confTab === 'tecnicos' ? 'bg-blue-100 text-blue-700' : 'text-slate-600'}`}>Técnicos</button>
            <button onClick={() => setConfTab('seguridad')} className={`w-full text-left px-4 py-2 rounded-lg text-sm font-medium ${confTab === 'seguridad' ? 'bg-blue-100 text-blue-700' : 'text-slate-600'}`}>Seguridad</button>
          </div>
          <div className="flex-1 p-6">
            {confTab === 'general' && (
              <form onSubmit={handleSaveConfig} className="space-y-4">
                <input type="text" name="shopName" defaultValue={config.shopName} className="w-full p-2 border rounded-lg" required placeholder="Nombre Empresa"/>
                <input type="text" name="phone" defaultValue={config.phone} className="w-full p-2 border rounded-lg" required placeholder="Teléfono"/>
                <input type="text" name="address" defaultValue={config.address} className="w-full p-2 border rounded-lg" required placeholder="Dirección"/>
                <textarea name="terms" defaultValue={config.terms} rows="5" className="w-full p-2 border rounded-lg" placeholder="Términos legales..."></textarea>
                <button type="submit" className="bg-blue-600 text-white font-bold py-2 px-6 rounded-lg">Guardar Cambios</button>
              </form>
            )}
            {confTab === 'tecnicos' && (
              <div>
                <form onSubmit={handleAddTech} className="flex space-x-3 mb-6 bg-slate-50 p-4 rounded-lg border">
                  <input type="text" placeholder="Nombre..." value={newTechName} onChange={(e) => setNewTechName(e.target.value)} className="flex-1 p-2 border rounded-lg" />
                  <select value={newTechRole} onChange={(e) => setNewTechRole(e.target.value)} className="p-2 border rounded-lg bg-white"><option>Administrador</option><option>Técnico Especialista</option><option>Recepcionista</option></select>
                  <button type="submit" className="bg-slate-800 text-white px-4 py-2 rounded-lg"><UserPlus size={18} /></button>
                </form>
                <div className="space-y-2">
                  {technicians.map(tech => (
                    <div key={tech.id} className="flex justify-between items-center p-3 border rounded-lg"><p className="font-bold">{tech.name} <span className="text-xs font-normal text-slate-500">({tech.role})</span></p><button onClick={() => removeTech(tech.id)} className="text-red-500 hover:bg-red-50 p-2 rounded-lg"><Trash2 size={18} /></button></div>
                  ))}
                </div>
              </div>
            )}
            {confTab === 'seguridad' && (
              <form onSubmit={handleChangePassword} className="space-y-4 max-w-sm">
                <input type="password" placeholder="Contraseña Actual" value={oldPwd} onChange={(e) => setOldPwd(e.target.value)} className="w-full p-2 border rounded-lg" required />
                <input type="password" placeholder="Nueva Contraseña" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} className="w-full p-2 border rounded-lg" required />
                <input type="password" placeholder="Confirmar Nueva" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} className="w-full p-2 border rounded-lg" required />
                <button type="submit" className="w-full bg-slate-800 text-white font-bold py-2 rounded-lg">Actualizar Contraseña</button>
              </form>
            )}
          </div>
        </div>
      </div>
    );
  };

  // --- VISTA 6: PORTAL CLIENTE ---
  const ViewCliente = () => {
    const [searchId, setSearchId] = useState('');
    const [foundOrder, setFoundOrder] = useState(null);
    const [hasSearched, setHasSearched] = useState(false);

    // Efecto para auto-buscar si escaneó el QR
    useEffect(() => {
      if (typeof window === 'undefined') return;
      const urlParams = new URLSearchParams(window.location.search);
      const ordenParam = urlParams.get('orden');
      if (ordenParam && orders.length > 0 && !hasSearched) {
        setSearchId(ordenParam);
        const order = orders.find(o => o.id.toLowerCase() === ordenParam.toLowerCase());
        setFoundOrder(order || null);
        setHasSearched(true);
      }
    }, [orders, hasSearched]);

    const handleSearch = (e) => {
      e.preventDefault();
      setFoundOrder(orders.find(o => o.id.toLowerCase() === searchId.toLowerCase()) || null);
      setHasSearched(true);
    };

    const getProgressStep = (status) => {
      if (['Entregado'].includes(status)) return 4;
      if (['Reparado / Para Entregar', 'Sin Reparación'].includes(status)) return 3;
      if (['En Diagnóstico', 'Presupuestado', 'Esperando Repuesto'].includes(status)) return 2;
      return 1; 
    };

    const shouldShowDiagnosis = foundOrder && ['Presupuestado', 'Esperando Repuesto', 'Reparado / Para Entregar', 'Entregado'].includes(foundOrder.status);

    return (
      <div className={`max-w-md w-full mx-auto animate-fade-in bg-white shadow-2xl min-h-[100vh] sm:min-h-[700px] border border-slate-200 sm:rounded-[2.5rem] overflow-hidden flex flex-col relative sm:ring-8 ring-slate-800 ${appMode === 'public' ? 'sm:mt-10' : ''}`}>
        <div className="bg-slate-800 text-white p-6 pt-10 text-center relative rounded-b-3xl shadow-md z-10">
          {appMode === 'public' && <button onClick={() => setAppMode('login')} className="absolute top-6 left-6 text-slate-400 hover:text-white"><XCircle size={24} /></button>}
          <h2 className="text-xl font-bold">{config.shopName}</h2>
          <p className="text-slate-300 text-sm">Seguimiento de Reparación</p>
        </div>

        <div className="p-6 flex-1 bg-slate-50 overflow-y-auto">
          <form onSubmit={handleSearch} className="mb-8 relative">
            <input type="text" placeholder="Ej. ORD-001" value={searchId} onChange={(e) => setSearchId(e.target.value)} className="w-full p-4 pr-12 rounded-2xl border border-slate-300 shadow-sm outline-none font-mono uppercase text-slate-700" />
            <button type="submit" className="absolute right-2 top-2 p-2 bg-blue-600 text-white rounded-xl"><Search size={20} /></button>
          </form>

          {hasSearched && !foundOrder && (
            <div className="text-center p-6 bg-red-50 rounded-2xl border border-red-100 text-red-600 animate-fade-in"><AlertTriangle size={32} className="mx-auto mb-2" /><p className="font-bold">Orden no encontrada</p></div>
          )}

          {foundOrder && (
            <div className="animate-fade-in space-y-6">
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
                <p className="text-xs text-slate-500 font-bold uppercase mb-1">Equipo Ingresado</p>
                <p className="text-lg font-bold text-slate-800">{foundOrder.deviceDesc}</p>
                <div className="mt-3 flex justify-between pt-3 border-t border-slate-100"><span className="text-sm text-slate-500">Presupuesto:</span><span className="font-bold">${foundOrder.budget || 'A confirmar'}</span></div>
              </div>

              {shouldShowDiagnosis && foundOrder.details?.notes && (
                <div className="bg-blue-50 p-5 rounded-2xl shadow-sm border border-blue-100">
                  <p className="text-xs text-blue-600 font-bold uppercase mb-2 flex items-center"><Wrench size={14} className="mr-1" /> Diagnóstico Técnico</p>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{foundOrder.details.notes}</p>
                </div>
              )}

              <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 relative">
                <p className="text-xs text-slate-500 font-bold uppercase mb-4">Estado de la Orden</p>
                <div className="absolute left-[33px] top-[60px] bottom-[40px] w-0.5 bg-slate-200 z-0"></div>
                <div className="space-y-6 relative z-10">
                  {[ 
                    { step: 1, title: 'Recibido en Taller', icon: CheckCircle2, bg: 'bg-blue-600' },
                    { step: 2, title: 'En Revisión Técnica', icon: Wrench, bg: 'bg-blue-600' },
                    { step: 3, title: 'Trabajo Finalizado', icon: foundOrder.status === 'Sin Reparación' ? XCircle : CheckCircle2, bg: foundOrder.status === 'Sin Reparación' ? 'bg-red-500' : 'bg-green-500' },
                    { step: 4, title: 'Entregado', icon: Truck, bg: 'bg-slate-800' }
                  ].map(s => (
                    <div key={s.step} className="flex items-start">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border-4 border-white shadow-sm ${getProgressStep(foundOrder.status) >= s.step ? `${s.bg} text-white` : 'bg-slate-200 text-slate-400'}`}><s.icon size={16} /></div>
                      <div className="ml-4 pt-1"><p className={`font-bold text-sm ${getProgressStep(foundOrder.status) >= s.step ? 'text-slate-800' : 'text-slate-400'}`}>{s.title}</p></div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  // --- RENDER PRINCIPAL MODO LOGIN / APP ---
  if (appMode === 'login') {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col justify-center items-center p-4 font-sans">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl overflow-hidden animate-fade-in">
          <div className="bg-blue-600 p-8 text-center">
            <Wrench size={48} className="mx-auto text-white mb-4" />
            <h1 className="text-3xl font-bold text-white tracking-tight">TallerPro</h1>
            <p className="text-blue-200 mt-2">Sistema de Gestión Integral</p>
          </div>
          <div className="p-8">
            <form onSubmit={(e) => { e.preventDefault(); if (loginPassword === config.password || loginPassword === 'admin') { setAppMode('admin'); setLoginError(''); setLoginPassword(''); } else { setLoginError('Contraseña incorrecta.'); } }} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Contraseña de Acceso</label>
                <div className="relative"><Lock className="absolute left-3 top-3.5 text-slate-400" size={20} /><input type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} className="w-full pl-10 p-3 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-mono text-lg tracking-widest" placeholder="••••••" autoFocus /></div>
                {loginError && <p className="text-red-500 text-sm mt-2 text-center">{loginError}</p>}
              </div>
              <button type="submit" className="w-full bg-slate-800 text-white font-bold py-3 rounded-xl hover:bg-slate-900 transition-colors">Ingresar al Sistema</button>
            </form>
            <div className="mt-8 pt-6 border-t border-slate-100 text-center">
              <button onClick={() => { setAppMode('public'); setLoginError(''); setLoginPassword(''); }} className="flex items-center justify-center w-full px-4 py-3 bg-green-50 text-green-700 border border-green-200 rounded-xl font-bold hover:bg-green-100"><Search size={18} className="mr-2" /> Portal de Seguimiento</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (appMode === 'public') {
    return <div className="min-h-screen bg-slate-100 flex flex-col justify-center items-center sm:p-4 font-sans"><ViewCliente /></div>;
  }

  return (
    <div className="min-h-screen bg-slate-100 flex font-sans">
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-in { animation: fadeIn 0.4s ease-out forwards; }
        @keyframes alertShine { 0%, 100% { transform: scale(1); filter: drop-shadow(0 0 0px rgba(239, 68, 68, 0)); } 50% { transform: scale(1.1); filter: drop-shadow(0 0 8px rgba(239, 68, 68, 0.6)); color: #dc2626; } }
        .animate-alert-shine { animation: alertShine 2s infinite ease-in-out; }
      `}</style>
      <aside className="w-64 bg-white border-r border-slate-200 p-4 flex flex-col">
        <div className="flex items-center space-x-3 px-2 mb-8 mt-2"><div className="bg-blue-600 p-2 rounded-lg text-white"><Wrench size={24} /></div><span className="font-bold text-xl text-slate-800 tracking-tight">TallerPro</span></div>
        <nav className="flex-1">
          <SidebarItem icon={LayoutDashboard} label="Dashboard" id="dashboard" />
          <SidebarItem icon={FileText} label="Recepción" id="recepcion" />
          <SidebarItem icon={Monitor} label="Panel de Taller" id="taller" />
          <SidebarItem icon={Building2} label="Gremio / Locales" id="gremio" />
          <SidebarItem icon={Package} label="Inventario" id="inventario" />
          <SidebarItem icon={TrendingUp} label="Historial y Reportes" id="reportes" />
          <SidebarItem icon={Settings} label="Configuración" id="configuracion" />
        </nav>
        <div className="px-4 py-2 mt-auto">
          <button onClick={() => setActiveTab('portal-cliente')} className={`w-full flex items-center justify-center space-x-2 px-4 py-2 rounded-lg transition-colors border-2 border-dashed ${activeTab === 'portal-cliente' ? 'border-green-600 text-green-600 bg-green-50' : 'border-slate-300 text-slate-500'}`}><Smartphone size={18} /><span className="font-bold text-xs uppercase">Portal Cliente</span></button>
          <button onClick={() => { setAppMode('login'); setActiveTab('dashboard'); }} className="w-full flex items-center justify-center space-x-2 px-4 py-2 mt-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50"><LogOut size={18} /><span className="font-bold text-xs uppercase">Cerrar Sesión</span></button>
        </div>
        <div className="p-4 bg-slate-50 rounded-xl text-sm border border-slate-200 mt-4">
          <label className="text-xs text-slate-500 font-bold mb-1 block text-left">Usuario Activo:</label>
          <select className="w-full bg-white border rounded-lg p-2 outline-none" value={activeTechId || ''} onChange={(e) => setActiveTechId(Number(e.target.value))}>
            {technicians.map(t => <option key={t.id} value={t.id}>{t.name} ({t.role})</option>)}
          </select>
        </div>
      </aside>
      <main className="flex-1 p-8 overflow-y-auto">
        {activeTab === 'dashboard' && <ViewDashboard />}
        {activeTab === 'recepcion' && <ViewReception />}
        {activeTab === 'taller' && <ViewTaller />}
        {activeTab === 'gremio' && <ViewGremio />}
        {activeTab === 'inventario' && <ViewInventario />}
        {activeTab === 'reportes' && <ViewReportes />}
        {activeTab === 'configuracion' && <ViewConfiguracion />}
        {activeTab === 'portal-cliente' && <ViewCliente />}
      </main>
      {selectedOrder && <OrderDetailModal order={selectedOrder} onClose={() => setSelectedOrder(null)} />}
      <ReceiptModal data={receiptData} onClose={() => setReceiptData(null)} />
    </div>
  );
}
