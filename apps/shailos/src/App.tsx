import React, { useState, useEffect, useRef } from 'react';
import { 
  Mic, 
  Square, 
  Plus, 
  FileText, 
  CheckCircle, 
  Clock, 
  Search,
  ChevronRight,
  MoreVertical,
  Trash2,
  Edit2,
  Send,
  Loader2,
  AlertCircle,
  Phone,
  Copy,
  FlaskConical,
  RefreshCw
} from 'lucide-react';
import {
  onAuthStateChanged,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  collection,
  addDoc,
  query,
  onSnapshot,
  orderBy,
  Timestamp,
  deleteDoc,
  doc,
  updateDoc,
  getDocFromServer
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { transcribeAndParse, performResearch, findPotentialMatches, transcribeAudio, generateSynopsis, generateAnswerSummary } from './services/geminiService';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
};

function mediaRecorderOptions(): MediaRecorderOptions | undefined {
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return { mimeType: 'audio/webm;codecs=opus' };
  if (MediaRecorder.isTypeSupported('audio/webm')) return { mimeType: 'audio/webm' };
  return undefined;
}

// --- Types ---
interface Shaila {
  id: string;
  date: string;
  askerName?: string;
  content: string;
  parsedShaila?: string;
  synopsis?: string;
  answer?: string;
  answerSummary?: string;
  answererName?: string;
  reasons?: string;
  status: 'pending' | 'answered' | 'got_back';
  researchReport?: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
  userId: string;
  _manualDraft?: boolean;
}

interface PendingRecordingMeta {
  id: string;
  kind: 'shaila' | 'call' | 'quick_mic';
  createdAt: number;
  mimeType: string;
  size: number;
  error?: string;
}

interface PendingRecording extends PendingRecordingMeta {
  blob: Blob;
}

const PENDING_DB = 'onetask_shailos_pending_audio';
const PENDING_STORE = 'recordings';

function openPendingDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PENDING_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PENDING_STORE)) db.createObjectStore(PENDING_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Could not open pending audio store'));
  });
}

async function withPendingStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | void> {
  const db = await openPendingDb();
  return new Promise<T | void>((resolve, reject) => {
    const tx = db.transaction(PENDING_STORE, mode);
    const store = tx.objectStore(PENDING_STORE);
    const req = fn(store);
    if (req) {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Pending audio operation failed'));
    } else {
      tx.oncomplete = () => resolve(undefined);
    }
    tx.onerror = () => reject(tx.error || new Error('Pending audio transaction failed'));
  }).finally(() => db.close());
}

async function savePendingRecording(blob: Blob, kind: PendingRecordingMeta['kind']): Promise<PendingRecordingMeta> {
  const meta: PendingRecordingMeta = {
    id: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    kind,
    createdAt: Date.now(),
    mimeType: blob.type || 'audio/webm',
    size: blob.size,
  };
  await withPendingStore('readwrite', store => store.put({ ...meta, blob }));
  return meta;
}

async function listPendingRecordings(): Promise<PendingRecordingMeta[]> {
  const records = await withPendingStore<PendingRecording[]>('readonly', store => store.getAll()) as PendingRecording[] | undefined;
  return (records || [])
    .map(({ blob, ...meta }) => meta)
    .sort((a, b) => b.createdAt - a.createdAt);
}

async function getPendingRecording(id: string): Promise<PendingRecording | null> {
  return (await withPendingStore<PendingRecording>('readonly', store => store.get(id)) as PendingRecording | undefined) || null;
}

async function updatePendingRecordingError(id: string, error: string): Promise<void> {
  const rec = await getPendingRecording(id);
  if (!rec) return;
  await withPendingStore('readwrite', store => store.put({ ...rec, error }));
}

async function deletePendingRecording(id: string): Promise<void> {
  await withPendingStore('readwrite', store => { store.delete(id); });
}

// --- Components ---

const Button = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost', size?: 'sm' | 'md' | 'lg' }>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => {
    const variants = {
      primary: 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm',
      secondary: 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 shadow-sm',
      danger: 'bg-red-500 text-white hover:bg-red-600 shadow-sm',
      ghost: 'bg-transparent text-slate-600 hover:bg-slate-100'
    };
    const sizes = {
      sm: 'px-3 py-1.5 text-sm',
      md: 'px-4 py-2',
      lg: 'px-6 py-3 text-lg'
    };
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center rounded-lg font-medium transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none',
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      />
    );
  }
);

const Card = ({ children, className }: { children: React.ReactNode, className?: string }) => (
  <div className={cn('bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden', className)}>
    {children}
  </div>
);

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'w-full px-4 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all',
        className
      )}
      {...props}
    />
  )
);

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'w-full px-4 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all resize-none',
        className
      )}
      {...props}
    />
  )
);

// --- Error Handling ---

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      let displayMessage = "Something went wrong.";
      try {
        const parsed = JSON.parse(this.state.error.message);
        if (parsed.error) displayMessage = `Error: ${parsed.error}`;
      } catch (e) {
        displayMessage = this.state.error.message || displayMessage;
      }

      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <Card className="max-w-md w-full p-8 text-center border-red-200">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-slate-900 mb-2">Application Error</h2>
            <p className="text-slate-600 mb-6">{displayMessage}</p>
            <Button onClick={() => window.location.reload()} className="w-full">
              Reload Application
            </Button>
          </Card>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- Main App Wrapper ---
export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [shailos, setShailos] = useState<Shaila[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isCallRecording, setIsCallRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const researchingSetRef = useRef<Set<string>>(new Set());
  const [researchTick, setResearchTick] = useState(0);
  const isResearching = (id: string) => researchingSetRef.current.has(id);
  const [isGeneratingSynopsis, setIsGeneratingSynopsis] = useState<string | null>(null);
  const [pastedText, setPastedText] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedShaila, setSelectedShaila] = useState<Shaila | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'answered' | 'got_back'>('all');
  const [pendingShailos, setPendingShailos] = useState<any[]>([]);
  const [pendingRecordings, setPendingRecordings] = useState<PendingRecordingMeta[]>([]);
  const [processingRecordingId, setProcessingRecordingId] = useState<string | null>(null);
  const [potentialMatches, setPotentialMatches] = useState<{ newShaila: any, matches: Shaila[] } | null>(null);
  const [isTranscribingField, setIsTranscribingField] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const researchRef = useRef<HTMLDivElement>(null);

  // Derive the canonical document key the same way the main app does:
  // canonicalUid = email prefix (e.g. rabbidanziger@hocsouthbend.com → "rabbidanziger")
  const USER_ID = user?.email?.split('@')[0]?.toLowerCase()?.trim() ?? 'unauthenticated';
  const shailosCol = () => collection(db, 'users', USER_ID, 'shailos');

  const refreshPendingRecordings = async () => {
    try {
      setPendingRecordings(await listPendingRecordings());
    } catch (err) {
      console.error("Pending recording load error:", err);
    }
  };

  // Sync theme from OneTask (same origin — reads onetask_theme localStorage key)
  useEffect(() => {
    const apply = () => {
      try {
        const sc = JSON.parse(localStorage.getItem('onetask_theme') || 'null');
        if (!sc) return;
        const r = document.documentElement;
        r.style.setProperty('--ot-bg',         sc.bg    || '#EDE5D8');
        r.style.setProperty('--ot-card',        sc.card  || '#F5EFE5');
        r.style.setProperty('--ot-text',        sc.text  || '#3D3633');
        r.style.setProperty('--ot-text-soft',   sc.tSoft || '#6E5848');
        r.style.setProperty('--ot-text-faint',  sc.tFaint|| '#7E6858');
        r.style.setProperty('--ot-border',      sc.brd   || '#D8CEBC');
        r.style.setProperty('--ot-border-s',    sc.brdS  || '#E4DBCE');
        r.style.setProperty('--ot-primary',     sc.primary || sc.text || '#C96442');
        r.style.setProperty('--ot-on-primary',  sc.onPrimary || sc.bg || '#FFFFFF');
        r.style.setProperty('--ot-tonal',       sc.tonal || sc.brdS || '#F7E4DA');
        r.style.setProperty('--ot-on-tonal',    sc.onTonal || sc.text || '#71331F');
      } catch {}
    };
    apply();
    window.addEventListener('storage', apply);
    return () => window.removeEventListener('storage', apply);
  }, []);

  // Auth — picks up the session already stored by OneTask (same Firebase project)
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    refreshPendingRecordings();
  }, []);

  // Handle ?action= param from task app FAB buttons
  useEffect(() => {
    const action = new URLSearchParams(window.location.search).get('action');
    if (action === 'add-manual' && user) {
      handleAddManually();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Firestore Listener
  useEffect(() => {
    if (!user) return;
    
    // Test connection
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'users', USER_ID));
      } catch (err) {
        if (err instanceof Error && err.message.includes('the client is offline')) {
          console.error("Firebase configuration error: client is offline");
        }
      }
    };
    testConnection();

    const q = query(
      shailosCol(),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Shaila));
      setShailos(data);
      // Sync background-updated fields into selectedShaila without clobbering user edits
      setSelectedShaila(prev => {
        if (!prev) return prev;
        const updated = data.find(s => s.id === prev.id);
        if (!updated) return prev;
        if (
          updated.researchReport !== prev.researchReport ||
          updated.answerSummary !== prev.answerSummary ||
          updated.status !== prev.status
        ) {
          return {
            ...prev,
            researchReport: updated.researchReport,
            answerSummary: updated.answerSummary,
            status: updated.status,
          };
        }
        return prev;
      });
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'shailos');
    });

    return unsubscribe;
  }, [user]);

  // Auto-scroll to research findings when they arrive
  useEffect(() => {
    if (selectedShaila?.researchReport) {
      scrollToResearch();
    }
  }, [selectedShaila?.researchReport]);

  const scrollToResearch = () => {
    setTimeout(() => {
      researchRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  // --- Handlers ---

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      setupMediaRecorder(stream, [], undefined, 'shaila');
      setIsRecording(true);
    } catch (err) {
      console.error("Recording error:", err);
      setError("Microphone access denied or not available.");
    }
  };

  const startCallRecording = async () => {
    try {
      // Capture system audio (via screen sharing)
      // Simplest form to ensure maximum compatibility
      const displayStream = await navigator.mediaDevices.getDisplayMedia({ 
        video: true, 
        audio: true 
      });

      if (!displayStream.getAudioTracks().length) {
        displayStream.getTracks().forEach(t => t.stop());
        throw new Error("No system audio track found. Did you check 'Share system audio'?");
      }

      // Capture microphone
      const micStream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);

      // Mix streams
      const audioContext = new AudioContext();
      const destination = audioContext.createMediaStreamDestination();

      const micSource = audioContext.createMediaStreamSource(micStream);
      const displaySource = audioContext.createMediaStreamSource(displayStream);

      micSource.connect(destination);
      displaySource.connect(destination);

      const mixedStream = destination.stream;
      
      // Keep track of all tracks to stop them later
      const allTracks = [...displayStream.getTracks(), ...micStream.getTracks()];
      
      setupMediaRecorder(mixedStream, allTracks, () => audioContext.close().catch(() => {}), 'call');
      setIsCallRecording(true);
    } catch (err) {
      console.error("Call recording error:", err);
      setError("Failed to start call recording. Ensure you share system audio.");
    }
  };

  const setupMediaRecorder = (stream: MediaStream, extraTracks: MediaStreamTrack[] = [], onCleanup?: () => void, kind: PendingRecordingMeta['kind'] = 'shaila') => {
    const mediaRecorder = new MediaRecorder(stream, mediaRecorderOptions());
    mediaRecorderRef.current = mediaRecorder;
    audioChunksRef.current = [];

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunksRef.current.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType || 'audio/webm' });
      stream.getTracks().forEach(track => track.stop());
      extraTracks.forEach(track => track.stop());
      onCleanup?.();
      try {
        const pending = await savePendingRecording(audioBlob, kind);
        await refreshPendingRecordings();
        processPendingRecording(pending.id);
      } catch (err) {
        console.error("Pending recording save error:", err);
        setError("Could not save recording before transcription. Please try again.");
      }
    };

    mediaRecorder.start(1000);
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && (isRecording || isCallRecording)) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsCallRecording(false);
    }
  };

  const processPendingRecording = async (recordingId: string) => {
    const pending = await getPendingRecording(recordingId);
    if (!pending) {
      await refreshPendingRecordings();
      return;
    }
    setIsProcessing(true);
    setProcessingRecordingId(recordingId);
    setError(null);
    try {
      if (pending.kind === 'quick_mic') {
        const transcription = await transcribeAudio(pending.blob, "Transcribe this audio faithfully.");
        setPastedText((prev) => `${prev}${prev.trim() ? ' ' : ''}${transcription.trim()}`);
        setShowAddModal(true);
        await deletePendingRecording(recordingId);
        await refreshPendingRecordings();
        return;
      }

      const results = await transcribeAndParse(pending.blob, true);
      for (const result of results) {
        const matchIds = await findPotentialMatches(result, shailos);
        if (matchIds.length > 0) {
          const matches = shailos.filter(s => matchIds.includes(s.id));
          setPotentialMatches({ newShaila: result, matches });
          // We'll handle one at a time for simplicity
          break; 
        } else {
          await saveShailos([result]);
        }
      }
      await deletePendingRecording(recordingId);
      await refreshPendingRecordings();
    } catch (err) {
      console.error("Processing error:", err);
      const msg = err instanceof Error ? err.message : String(err);
      await updatePendingRecordingError(recordingId, msg).catch(() => {});
      await refreshPendingRecordings();
      setError("Transcription failed. The audio is saved in the holding pen below. " + msg);
    } finally {
      setIsProcessing(false);
      setProcessingRecordingId(null);
    }
  };

  const deleteHeldRecording = async (recordingId: string) => {
    if (processingRecordingId === recordingId) return;
    await deletePendingRecording(recordingId);
    await refreshPendingRecordings();
  };

  const handlePasteSubmit = async () => {
    if (!pastedText.trim()) return;
    setIsProcessing(true);
    setError(null);
    try {
      const results = await transcribeAndParse(pastedText, false);
      for (const result of results) {
        const matchIds = await findPotentialMatches(result, shailos);
        if (matchIds.length > 0) {
          const matches = shailos.filter(s => matchIds.includes(s.id));
          setPotentialMatches({ newShaila: result, matches });
          break;
        } else {
          await saveShailos([result]);
        }
      }
      setPastedText('');
      setShowAddModal(false);
    } catch (err) {
      console.error("Processing error:", err);
      setError("Parse failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleGotBack = async (shaila: Shaila) => {
    const newStatus = shaila.status === 'got_back' ? 'answered' : 'got_back';
    try {
      await updateDoc(doc(shailosCol(),shaila.id), { status: newStatus, updatedAt: Timestamp.now() });
      if (selectedShaila?.id === shaila.id) setSelectedShaila({ ...selectedShaila, status: newStatus });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `shailos/${shaila.id}`);
    }
  };

  const integrateShaila = async (existingShaila: Shaila, newData: any) => {
    try {
      const updatedContent = `${existingShaila.content}\n\n[Follow-up ${format(new Date(), 'MM/dd')}]: ${newData.shailaContent}`;
      const updatedAnswer = newData.answer ? `${existingShaila.answer}\n\n[New Info]: ${newData.answer}` : existingShaila.answer;
      
      await updateDoc(doc(shailosCol(), existingShaila.id), {
        content: updatedContent,
        answer: updatedAnswer,
        status: (updatedAnswer && updatedAnswer.trim() !== "") ? 'answered' : existingShaila.status,
        updatedAt: Timestamp.now()
      });
      setPotentialMatches(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `shailos/${existingShaila.id}`);
    }
  };

  const saveShailos = async (shailosData: any[]) => {
    if (!user) return;
    try {
      const promises = shailosData.map(data =>
        addDoc(shailosCol(), {
          date: format(new Date(), 'yyyy-MM-dd HH:mm'),
          askerName: data.askerName || 'Unknown',
          content: data.shailaContent || pastedText || 'Audio Transcript',
          parsedShaila: data.parsedShaila,
          synopsis: data.synopsis || (data.shailaContent ? data.shailaContent.substring(0, 50) + '...' : 'New Shaila'),
          answer: data.answer || '',
          answererName: data.answererName || '',
          reasons: data.reasons || '',
          status: data.answer && data.answer.trim() !== "" ? 'answered' : 'pending',
          createdAt: Timestamp.now(),
          userId: USER_ID
        })
      );
      await Promise.all(promises);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'shailos');
    }
  };

  const startFieldTranscription = async (field: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      const mediaRecorder = new MediaRecorder(stream, mediaRecorderOptions());
      const chunks: Blob[] = [];
      
      setIsTranscribingField(field);
      
      mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        try {
          const transcription = await transcribeAudio(blob, "Transcribe this audio faithfully. It is a halachic answer or additional information for a shaila.");
          if (selectedShaila) {
            if (field === 'answer') {
              setSelectedShaila({ ...selectedShaila, answer: (selectedShaila.answer || '') + ' ' + transcription });
            } else if (field === 'content') {
              setSelectedShaila({ ...selectedShaila, content: (selectedShaila.content || '') + ' ' + transcription });
            } else if (field === 'synopsis') {
              setSelectedShaila({ ...selectedShaila, synopsis: transcription });
            } else if (field === 'askerName') {
              setSelectedShaila({ ...selectedShaila, askerName: transcription });
            } else if (field === 'date') {
              setSelectedShaila({ ...selectedShaila, date: transcription });
            }
          }
        } catch (err) {
          console.error("Field transcription error:", err);
        } finally {
          setIsTranscribingField(null);
          stream.getTracks().forEach(t => t.stop());
        }
      };
      
      mediaRecorder.start(1000);
      // Stop after 10 seconds or manual stop
      setTimeout(() => {
        if (mediaRecorder.state === 'recording') mediaRecorder.stop();
      }, 30000);
      
    } catch (err) {
      console.error("Mic access error:", err);
    }
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
      reader.readAsDataURL(blob);
    });
  };
  const deleteShaila = async (id: string) => {
    try {
      await deleteDoc(doc(shailosCol(),id));
      if (selectedShaila?.id === id) setSelectedShaila(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `shailos/${id}`);
    }
  };

  const handleResearch = async (shaila: Shaila) => {
    if (researchingSetRef.current.has(shaila.id)) return; // already running
    researchingSetRef.current.add(shaila.id);
    setResearchTick(t => t + 1);
    try {
      // Pass synopsis + content for cleaner search input (strips asker name, metadata)
      const query = shaila.synopsis
        ? `${shaila.synopsis}\n\n${shaila.content}`
        : shaila.content;
      const report = await performResearch(query);
      await updateDoc(doc(shailosCol(), shaila.id), {
        researchReport: report,
        updatedAt: Timestamp.now()
      });
    } catch (err) {
      console.error("Research error:", err);
      setError("Research failed — " + (err instanceof Error ? err.message : String(err)));
    } finally {
      researchingSetRef.current.delete(shaila.id);
      setResearchTick(t => t + 1);
    }
  };

  const handleRegenerateSynopsis = async (shaila: Shaila) => {
    if (isGeneratingSynopsis) return;
    setIsGeneratingSynopsis(shaila.id);
    try {
      const newSynopsis = await generateSynopsis(shaila.content);
      setSelectedShaila({ ...shaila, synopsis: newSynopsis });
      await updateDoc(doc(shailosCol(),shaila.id), {
        synopsis: newSynopsis,
        updatedAt: Timestamp.now()
      });
    } catch (err) {
      console.error("Synopsis regeneration error:", err);
      setError("Failed to regenerate synopsis. Please try again.");
    } finally {
      setIsGeneratingSynopsis(null);
    }
  };

  const handleAddManually = async () => {
    if (!user) return;
    const now = Timestamp.now();
    const dateStr = format(new Date(), 'yyyy-MM-dd HH:mm');
    setSelectedShaila({
      id: `manual-draft-${Date.now()}`,
      date: dateStr,
      askerName: '',
      content: '',
      parsedShaila: '',
      synopsis: '',
      answer: '',
      answererName: '',
      reasons: '',
      status: 'pending',
      createdAt: now,
      userId: USER_ID,
      _manualDraft: true,
    });
  };

  const saveShailaDetails = async (shaila: Shaila, options: { submitManualDraft?: boolean } = {}) => {
    try {
      if (shaila._manualDraft && !options.submitManualDraft) {
        setSelectedShaila(shaila);
        return;
      }
      const questionText = (shaila.content || shaila.parsedShaila || '').trim();
      const synopsisText = (shaila.synopsis || questionText.substring(0, 80)).trim();
      if (shaila._manualDraft && !questionText && !synopsisText) {
        setError("Add the shaila details before saving.");
        return;
      }
      const status = shaila.status === 'got_back' ? 'got_back' :
        (shaila.answer || '').trim() !== "" ? 'answered' : 'pending';
      // Regenerate answer summary whenever answer is present and has changed (or summary missing)
      const prevShaila = shailos.find(s => s.id === shaila.id);
      const answerChanged = (shaila.answer || '') !== (prevShaila?.answer || '');
      let answerSummary = shaila.answerSummary || '';
      if ((shaila.answer || '').trim() && (answerChanged || !answerSummary)) {
        try { answerSummary = await generateAnswerSummary(shaila.answer!); } catch (_) {}
      }
      const payload = {
        date: shaila.date,
        content: questionText,
        parsedShaila: shaila.parsedShaila || questionText,
        synopsis: synopsisText,
        askerName: shaila.askerName || 'Unknown',
        answer: shaila.answer || '',
        answerSummary,
        answererName: shaila.answererName || '',
        reasons: shaila.reasons || '',
        status,
        updatedAt: Timestamp.now()
      };
      if (shaila._manualDraft) {
        const docRef = await addDoc(shailosCol(), {
          ...payload,
          createdAt: shaila.createdAt || Timestamp.now(),
          userId: USER_ID,
        });
        setSelectedShaila({ ...shaila, ...payload, id: docRef.id, status, _manualDraft: false });
        return;
      }
      await updateDoc(doc(shailosCol(),shaila.id), {
        ...payload,
      });
      setSelectedShaila({ ...shaila, status, answerSummary });
    } catch (err) {
      handleFirestoreError(err, shaila._manualDraft ? OperationType.CREATE : OperationType.UPDATE, shaila._manualDraft ? 'shailos' : `shailos/${shaila.id}`);
    }
  };

  const STATUS_ORDER: Record<string, Record<string, number>> = {
    all:       { pending: 0, answered: 1, got_back: 2 },
    pending:   { pending: 0, answered: 1, got_back: 2 },
    answered:  { answered: 0, pending: 1, got_back: 2 },
    got_back:  { got_back: 0, answered: 1, pending: 2 },
  };

  const filteredShailos = shailos
    .filter(s => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return s.content.toLowerCase().includes(q) ||
        s.askerName?.toLowerCase().includes(q) ||
        s.parsedShaila?.toLowerCase().includes(q) ||
        s.synopsis?.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      const order = STATUS_ORDER[statusFilter] || STATUS_ORDER.all;
      const oa = order[a.status] ?? 3;
      const ob = order[b.status] ?? 3;
      if (oa !== ob) return oa - ob;
      // within same group, newest first
      return (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0);
    });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    // Simple feedback could be added here if needed
  };

  const formatShailaForCopy = (s: Shaila) => {
    return `Shaila from ${s.askerName} (${s.date})\n\n${s.parsedShaila || s.content}\n\nAnswer: ${s.answer || '[waiting for answer]'}\n${s.answererName ? `Answerer: ${s.answererName}\n` : ''}${s.reasons ? `Reasons: ${s.reasons}\n` : ''}\n-------------------\n`;
  };

  const copyAllShailos = () => {
    const text = filteredShailos.map(formatShailaForCopy).join('\n');
    copyToClipboard(text);
    alert("All filtered shailos copied to clipboard!");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full p-8 text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-900 mb-2">Sign in required</h2>
          <p className="text-slate-600 mb-6">Please sign in to OneTask first, then reload this page.</p>
          <Button onClick={() => window.location.reload()} className="w-full">Reload</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-bottom border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{background:"var(--ot-text)",color:"var(--ot-bg)"}}>
              <Mic className="w-5 h-5" />
            </div>
            <h1 className="font-bold text-lg text-slate-900 hidden sm:block">Shaila Transcriber</h1>
          </div>

          <button
            onClick={() => {
              if (window.parent !== window) window.parent.postMessage('shailos:close', '*');
              else window.history.back();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors hover:bg-slate-100"
            style={{color:"var(--ot-text)", border:"1px solid var(--ot-border)"}}
          >
            ← Task App
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto p-4 flex flex-col gap-6">
        {/* Actions Bar */}
        <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div className="flex gap-2 w-full sm:w-auto">
            {!isRecording && !isCallRecording ? (
              <>
                <Button 
                  onClick={startRecording} 
                  className="flex-1 sm:flex-none gap-2 bg-red-600 hover:bg-red-700"
                  disabled={isProcessing}
                >
                  <Mic className="w-4 h-4" />
                  Record Shaila
                </Button>
                <Button
                  onClick={() => {
                    // Delegate to the main app's ConvCapture (phone button = callMode).
                    // This avoids the broken proxy path and uses the exact same pipeline.
                    if (window.parent !== window) {
                      window.parent.postMessage('shailos:open-conv-capture', '*');
                    } else {
                      startCallRecording(); // fallback if opened standalone
                    }
                  }}
                  className="flex-1 sm:flex-none gap-2 bg-indigo-600 hover:bg-indigo-700"
                  disabled={isProcessing}
                >
                  <Phone className="w-4 h-4" />
                  Record Call
                </Button>
              </>
            ) : (
              <Button 
                onClick={stopRecording} 
                variant="danger"
                className="flex-1 sm:flex-none gap-2 animate-pulse"
              >
                <Square className="w-4 h-4" />
                Stop {isCallRecording ? 'Call' : ''} Recording
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => setShowAddModal(true)}
              className="flex-1 sm:flex-none gap-2"
              disabled={isProcessing || isRecording || isCallRecording}
            >
              <Plus className="w-4 h-4" />
              Paste Text
            </Button>
            <Button
              variant="secondary"
              onClick={handleAddManually}
              className="flex-1 sm:flex-none gap-2"
              disabled={isProcessing || isRecording || isCallRecording}
            >
              <Edit2 className="w-4 h-4" />
              Add Manually
            </Button>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input 
              placeholder="Search shailos..." 
              className="pl-10"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {isCallRecording && (
          <div className="bg-indigo-50 border border-indigo-200 text-indigo-700 px-4 py-2 rounded-lg text-xs flex items-center gap-2">
            <Phone className="w-3 h-3" />
            <p><strong>Tip:</strong> To record both sides, make sure to select the tab/window with the call and check <strong>"Also share system audio"</strong> in the browser popup.</p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-3">
            <AlertCircle className="w-5 h-5" />
            <p className="text-sm">{error}</p>
          </div>
        )}

        {isProcessing && (
          <div className="bg-indigo-50 border border-indigo-200 text-indigo-700 px-4 py-3 rounded-lg flex items-center gap-3 animate-pulse">
            <Loader2 className="w-5 h-5 animate-spin" />
            <p className="text-sm font-medium">Processing shaila with AI Dialect Support...</p>
          </div>
        )}

        {pendingRecordings.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h3 className="text-sm font-bold text-amber-900">Transcription Holding Pen</h3>
                <p className="text-xs text-amber-800 mt-0.5">
                  Audio is saved here until transcription succeeds, so failed quota calls do not lose the recording.
                </p>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 bg-amber-100 px-2 py-1 rounded-full">
                {pendingRecordings.length} saved
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {pendingRecordings.map((rec) => {
                const busy = processingRecordingId === rec.id;
                const label = rec.kind === 'call' ? 'Call recording' : rec.kind === 'quick_mic' ? 'Quick mic' : 'Shaila recording';
                const age = new Date(rec.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
                const mb = (rec.size / 1024 / 1024).toFixed(1);
                return (
                  <div key={rec.id} className="bg-white/80 border border-amber-100 rounded-lg p-3 flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{label}</p>
                      <p className="text-xs text-slate-500">{age} · {mb} MB</p>
                      {rec.error && <p className="text-xs text-red-700 mt-1 line-clamp-2">{rec.error}</p>}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => processPendingRecording(rec.id)} disabled={isProcessing} className="gap-1">
                        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                        Retry
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => deleteHeldRecording(rec.id)} disabled={busy}>
                        Delete
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Shailos List */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-1 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-900 flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-600" />
                Recent Shailos
              </h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={copyAllShailos}
                className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 hover:text-indigo-700"
              >
                <Copy className="w-3 h-3 mr-1" />
                Copy All
              </Button>
            </div>
            <div className="flex gap-1 flex-wrap">
              {(['all', 'pending', 'answered', 'got_back'] as const).map((f) => {
                const labels = { all: 'All', pending: 'Researching', answered: 'Have Answer', got_back: 'Got Back' };
                return (
                  <button
                    key={f}
                    onClick={() => setStatusFilter(f)}
                    className={cn(
                      'px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-colors',
                      statusFilter === f
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    )}
                  >
                    {labels[f]}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-col gap-1.5 max-h-[calc(100vh-300px)] overflow-y-auto pr-1">
              {filteredShailos.length === 0 ? (
                <div className="text-center py-12 bg-white rounded-xl border border-dashed border-slate-300 text-slate-500">
                  No shailos found
                </div>
              ) : (
                filteredShailos.map((shaila) => (
                  <motion.div
                    key={shaila.id}
                    layoutId={shaila.id}
                    onClick={() => setSelectedShaila(shaila)}
                    className={cn(
                      'px-3 py-2 rounded-lg border cursor-pointer transition-all hover:shadow-sm group flex items-center justify-between gap-3',
                      selectedShaila?.id === shaila.id 
                        ? 'bg-indigo-50 border-indigo-200 ring-1 ring-indigo-200' 
                        : 'bg-white border-slate-200'
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-slate-900 text-sm mb-1 leading-snug break-words">
                        {shaila.synopsis || shaila.content}
                      </h3>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-medium text-slate-500 whitespace-nowrap">
                          {format(new Date(shaila.date), 'MMM d')}
                        </span>
                        <span className="text-[10px] font-medium text-slate-500 truncate">
                          {shaila.askerName}
                        </span>
                      </div>
                      {(shaila.status === 'answered' || shaila.status === 'got_back') && shaila.answer?.trim() && (() => {
                        const snippet = shaila.answerSummary?.trim() || (() => {
                          const words = (shaila.answer || '').trim().split(/\s+/).filter(Boolean);
                          return words.slice(0, 6).join(' ') + (words.length > 6 ? '…' : '');
                        })();
                        return (
                          <div className={`text-[10px] font-medium italic truncate whitespace-nowrap overflow-hidden mt-0.5 ${shaila.status === 'got_back' ? 'text-emerald-600' : 'text-amber-600'}`}>
                            {snippet}
                          </div>
                        );
                      })()}
                    </div>
                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                      {isResearching(shaila.id) && (
                        <span title="Researching...">
                          <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
                        </span>
                      )}
                      {!isResearching(shaila.id) && shaila.researchReport && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedShaila(shaila);
                            scrollToResearch();
                          }}
                          className="p-1 hover:bg-indigo-100 rounded-full transition-colors"
                          title="View Research"
                        >
                          <FlaskConical className="w-4 h-4 text-indigo-600" />
                        </button>
                      )}
                      {shaila.status === 'pending' && (
                        <span className="px-2 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-[10px] font-bold text-amber-600 whitespace-nowrap">
                          Researching
                        </span>
                      )}
                      {shaila.status === 'answered' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleGotBack(shaila); }}
                          className="flex items-center gap-1 px-2 py-0.5 rounded-full border border-amber-300 bg-amber-50 hover:bg-amber-100 transition-colors text-[10px] font-bold text-amber-700 whitespace-nowrap"
                          title="Got back to asker?"
                        >
                          Got back? <CheckCircle className="w-3 h-3" />
                        </button>
                      )}
                      {shaila.status === 'got_back' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleGotBack(shaila); }}
                          className="flex items-center gap-1 px-2 py-0.5 rounded-full border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 transition-colors text-[10px] font-bold text-emerald-700 whitespace-nowrap"
                          title="Undo: not yet got back"
                        >
                          Got back! ✓
                        </button>
                      )}
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </div>

          {/* Details View */}
          <div className="md:col-span-2">
            <AnimatePresence mode="wait">
              {selectedShaila ? (
                <motion.div
                  key={selectedShaila.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  <Card className="p-6 sm:p-8 min-h-[400px] flex flex-col">
                    <div className="flex justify-between items-start mb-6">
                      <div>
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className={cn(
                            'px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider',
                            selectedShaila._manualDraft ? 'bg-slate-100 text-slate-600' :
                            selectedShaila.status === 'got_back' ? 'bg-emerald-100 text-emerald-700' :
                            selectedShaila.status === 'answered' ? 'bg-amber-100 text-amber-700' :
                            'bg-amber-50 text-amber-600'
                          )}>
                            {selectedShaila._manualDraft ? 'Draft' :
                             selectedShaila.status === 'pending' ? 'Researching' :
                             selectedShaila.status === 'answered' ? 'Have Answer' : 'Got Back'}
                          </span>
                          {!selectedShaila._manualDraft && selectedShaila.status === 'answered' && (
                            <button
                              onClick={() => handleGotBack(selectedShaila)}
                              className="flex items-center gap-1.5 px-3 py-1 rounded-full border border-amber-300 bg-amber-50 hover:bg-amber-100 transition-colors text-xs font-bold text-amber-700"
                            >
                              Got back to asker? <CheckCircle className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {!selectedShaila._manualDraft && selectedShaila.status === 'got_back' && (
                            <button
                              onClick={() => handleGotBack(selectedShaila)}
                              className="flex items-center gap-1.5 px-3 py-1 rounded-full border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 transition-colors text-xs font-bold text-emerald-700"
                            >
                              Got back to asker! ✓ <span className="text-[10px] opacity-60">undo</span>
                            </button>
                          )}
                        </div>
                          <div className="flex items-center gap-1 group/date">
                            <Input
                              className="text-[10px] text-slate-400 font-mono bg-transparent border-none p-0 focus-visible:ring-0 h-auto w-auto"
                              value={selectedShaila.date || ''}
                              onChange={(e) => setSelectedShaila({ ...selectedShaila, date: e.target.value })}
                              onBlur={() => saveShailaDetails(selectedShaila)}
                            />
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => startFieldTranscription('date')}
                              className={cn("p-0.5 h-auto opacity-0 group-hover/date:opacity-100 transition-opacity", isTranscribingField === 'date' && "text-red-500 opacity-100 animate-pulse")}
                            >
                              <Mic className="w-3 h-3" />
                            </Button>
                          </div>
                        <div className="flex items-start gap-2 group/synopsis">
                          <Textarea
                            rows={2}
                            className="text-sm font-semibold text-slate-900 bg-transparent border-none p-0 focus-visible:ring-0 mb-1 flex-1 resize-none leading-snug"
                            value={selectedShaila.synopsis || ''}
                            onChange={(e) => setSelectedShaila({ ...selectedShaila, synopsis: e.target.value })}
                            onBlur={() => saveShailaDetails(selectedShaila)}
                            placeholder="Synopsis"
                          />
                          <div className="flex items-center gap-1 opacity-0 group-hover/synopsis:opacity-100 transition-opacity">
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => handleRegenerateSynopsis(selectedShaila)}
                              disabled={isGeneratingSynopsis === selectedShaila.id}
                              className={cn("p-1 h-auto text-indigo-600", isGeneratingSynopsis === selectedShaila.id && "animate-spin")}
                              title="Regenerate Synopsis"
                            >
                              <RefreshCw className="w-4 h-4" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => startFieldTranscription('synopsis')}
                              className={cn("p-1 h-auto", isTranscribingField === 'synopsis' && "text-red-500 opacity-100 animate-pulse")}
                              title="Dictate Synopsis"
                            >
                              <Mic className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mt-1 group/asker">
                          <span className="text-xs text-slate-500">Asker:</span>
                          <Input
                            className="text-xs font-medium text-slate-700 bg-transparent border-none p-0 focus-visible:ring-0 h-auto w-auto"
                            value={selectedShaila.askerName || ''}
                            onChange={(e) => setSelectedShaila({ ...selectedShaila, askerName: e.target.value })}
                            onBlur={() => saveShailaDetails(selectedShaila)}
                            placeholder="Unknown"
                          />
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => startFieldTranscription('askerName')}
                            className={cn("p-0.5 h-auto opacity-0 group-hover/asker:opacity-100 transition-opacity", isTranscribingField === 'askerName' && "text-red-500 opacity-100 animate-pulse")}
                          >
                            <Mic className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {!selectedShaila._manualDraft && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleResearch(selectedShaila)}
                              disabled={isResearching(selectedShaila.id)}
                              title="Research this shaila"
                            >
                              {isResearching(selectedShaila.id) ? (
                                <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                              ) : (
                                <FlaskConical className="w-4 h-4 text-slate-400 hover:text-indigo-600" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => copyToClipboard(formatShailaForCopy(selectedShaila))}
                              title="Copy to clipboard"
                            >
                              <Copy className="w-4 h-4 text-slate-400 hover:text-indigo-600" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteShaila(selectedShaila.id)}
                              title="Delete shaila"
                            >
                              <Trash2 className="w-4 h-4 text-slate-400 hover:text-red-500" />
                            </Button>
                          </>
                        )}
                        {selectedShaila._manualDraft && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedShaila(null)}
                            title="Cancel draft"
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="space-y-6 flex-1">
                      <section>
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Shaila Question</h4>
                        <Textarea
                          rows={5}
                          placeholder="The shaila text…"
                          value={selectedShaila.content || selectedShaila.parsedShaila || ''}
                          onChange={(e) => setSelectedShaila({ ...selectedShaila, content: e.target.value, parsedShaila: e.target.value })}
                          onBlur={() => saveShailaDetails(selectedShaila)}
                        />
                      </section>

                      <section>
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Answer Details</h4>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => startFieldTranscription('answer')}
                            className={cn(isTranscribingField === 'answer' && "text-red-500 animate-pulse")}
                          >
                            <Mic className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1">Answerer</label>
                            <Input
                              placeholder="e.g. YCD, CC"
                              value={selectedShaila.answererName || ''}
                              onChange={(e) => setSelectedShaila({ ...selectedShaila, answererName: e.target.value })}
                              onBlur={() => saveShailaDetails(selectedShaila)}
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <label className="block text-xs font-medium text-slate-500 mb-1">Answer & Reasons</label>
                            <Textarea
                              rows={4}
                              placeholder="[waiting for answer]"
                              value={selectedShaila.answer || ''}
                              onChange={(e) => setSelectedShaila({ ...selectedShaila, answer: e.target.value })}
                              onBlur={() => saveShailaDetails(selectedShaila)}
                            />
                          </div>
                        </div>
                        <div className="mt-4 flex justify-end">
                          <Button 
                            onClick={() => saveShailaDetails(selectedShaila, { submitManualDraft: true })}
                            className="gap-2"
                          >
                            <Send className="w-4 h-4" />
                            {selectedShaila._manualDraft ? 'Submit Shaila' : 'Save Details'}
                          </Button>
                        </div>
                      </section>

                      <section>
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Raw Transcript/Content</h4>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => startFieldTranscription('content')}
                            className={cn(isTranscribingField === 'content' && "text-red-500 animate-pulse")}
                          >
                            <Mic className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                        <Textarea
                          rows={4}
                          className="text-sm text-slate-600 bg-white p-4 rounded-xl border border-slate-100 italic w-full"
                          value={selectedShaila.content}
                          onChange={(e) => setSelectedShaila({ ...selectedShaila, content: e.target.value })}
                          onBlur={() => saveShailaDetails(selectedShaila)}
                        />
                      </section>
                    </div>
                    {/* Research Report */}
                    {selectedShaila.researchReport && (
                      <div ref={researchRef} className="mt-8 pt-8 border-t border-slate-100">
                        <div className="flex items-center justify-between mb-4">
                          <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                            <FlaskConical className="w-4 h-4 text-indigo-600" />
                            Research Findings
                          </h4>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => handleResearch(selectedShaila)}
                            disabled={isResearching(selectedShaila.id)}
                            className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 hover:text-indigo-700"
                          >
                            {isResearching(selectedShaila.id) ? (
                              <Loader2 className="w-3 h-3 animate-spin mr-1" />
                            ) : (
                              <Plus className="w-3 h-3 mr-1" />
                            )}
                            Redo Research
                          </Button>
                        </div>
                        <div className="prose prose-slate prose-sm max-w-none bg-indigo-50/50 p-4 rounded-xl border border-indigo-100/50">
                          <ReactMarkdown>{selectedShaila.researchReport}</ReactMarkdown>
                        </div>
                      </div>
                    )}
                  </Card>
                </motion.div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center p-12 bg-white rounded-xl border border-dashed border-slate-300">
                  <div className="w-16 h-16 bg-slate-50 text-slate-300 rounded-full flex items-center justify-center mb-4">
                    <FileText className="w-8 h-8" />
                  </div>
                  <h3 className="text-lg font-medium text-slate-900">No Shaila Selected</h3>
                  <p className="text-slate-500 max-w-xs">
                    Select a shaila from the list to view details, transcription, and provide an answer.
                  </p>
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      {/* Add Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddModal(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-bold text-slate-900">Paste Shaila Text</h3>
                  <p className="text-sm text-slate-500">Paste the text of a shaila to have it parsed by AI.</p>
                </div>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={async () => {
                    try {
                      const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
                      const mediaRecorder = new MediaRecorder(stream, mediaRecorderOptions());
                      const chunks: Blob[] = [];
                      setIsProcessing(true);
                      mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
                      mediaRecorder.onstop = async () => {
                        const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
                        stream.getTracks().forEach(t => t.stop());
                        try {
                          const pending = await savePendingRecording(blob, 'quick_mic');
                          await refreshPendingRecordings();
                          await processPendingRecording(pending.id);
                        } finally {
                          setIsProcessing(false);
                        }
                      };
                      mediaRecorder.start(1000);
                      setTimeout(() => { if (mediaRecorder.state === 'recording') mediaRecorder.stop(); }, 30000);
                    } catch (err) { console.error(err); setIsProcessing(false); }
                  }}
                  className={cn(isProcessing && "text-red-500 animate-pulse")}
                >
                  <Mic className="w-5 h-5" />
                </Button>
              </div>
              <div className="p-6">
                <Textarea 
                  rows={8}
                  placeholder="Paste text here..."
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  className="mb-4"
                />
                <div className="flex gap-3 justify-end">
                  <Button variant="ghost" onClick={() => setShowAddModal(false)}>Cancel</Button>
                  <Button onClick={handlePasteSubmit} disabled={!pastedText.trim() || isProcessing}>
                    {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Parse Shaila'}
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Potential Matches Modal */}
      <AnimatePresence>
        {potentialMatches && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 bg-indigo-50">
                <h3 className="text-xl font-bold text-indigo-900">Potential Follow-up Detected</h3>
                <p className="text-sm text-indigo-700">This recording seems related to an existing shaila. Should we integrate it?</p>
              </div>
              <div className="p-6 max-h-[60vh] overflow-y-auto">
                <div className="mb-6 p-4 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">New Recording</span>
                  <p className="text-sm font-medium text-slate-900 mt-1">{potentialMatches.newShaila.synopsis}</p>
                  <p className="text-xs text-slate-500 mt-1 italic">"{potentialMatches.newShaila.shailaContent}"</p>
                </div>

                <div className="space-y-3">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Suggested Matches</span>
                  {potentialMatches.matches.map((match) => (
                    <div 
                      key={match.id}
                      className="p-4 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30 cursor-pointer transition-all flex items-center justify-between group"
                      onClick={() => integrateShaila(match, potentialMatches.newShaila)}
                    >
                      <div>
                        <p className="text-sm font-bold text-slate-900">{match.synopsis}</p>
                        <p className="text-xs text-slate-500">Asker: {match.askerName} · {match.date}</p>
                      </div>
                      <Button size="sm" variant="ghost" className="opacity-0 group-hover:opacity-100">Integrate</Button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="p-6 border-t border-slate-100 flex justify-between gap-3">
                <Button variant="ghost" onClick={() => setPotentialMatches(null)}>Cancel</Button>
                <Button onClick={() => {
                  saveShailos([potentialMatches.newShaila]);
                  setPotentialMatches(null);
                }}>
                  Create as New Shaila
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="py-6 text-center text-xs text-slate-400 border-t border-slate-200 mt-auto">
        <p>© 2026 Shaila Transcriber · Built for R' Yosef Chaim Danziger</p>
      </footer>
    </div>
  );
}
