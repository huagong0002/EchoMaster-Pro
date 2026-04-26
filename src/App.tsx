import { useState, useRef, useEffect, useMemo } from 'react';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  Settings2, 
  BookOpen, 
  Clock, 
  Plus, 
  Trash2, 
  Download, 
  Upload,
  FastForward,
  Rewind,
  CheckCircle2,
  ListMusic,
  ArrowRight,
  Save,
  LogIn,
  LogOut,
  FolderOpen,
  Home as HomeIcon,
  User as UserIcon,
  ShieldCheck,
  Edit3,
  ArrowLeft
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { AudioSegment, ListeningMaterial } from './types';
import { auth, db, signOut, storage } from './lib/firebase';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { 
  getAuth, 
  onAuthStateChanged, 
  User, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword 
} from 'firebase/auth';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  doc, 
  setDoc,
  deleteDoc, 
  serverTimestamp,
  orderBy,
  getDocs,
  limit,
  getDoc
} from 'firebase/firestore';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Secondary Firebase app for admin tasks (prevents admin logout when creating users)
const getSecondaryAuth = () => {
  const app = getApps().find(a => a.name === 'secondary') || initializeApp(firebaseConfig, 'secondary');
  return getAuth(app);
};

export default function App() {
  const [mode, setMode] = useState<'setup' | 'edit' | 'train' | 'gallery'>('setup');
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showAuthOverlay, setShowAuthOverlay] = useState(false);
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authError, setAuthError] = useState('');
  const [adminError, setAdminError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [materials, setMaterials] = useState<(ListeningMaterial & { id: string })[]>([]);
  const [usersMap, setUsersMap] = useState<Record<string, string>>({}); // uid -> username
  const [material, setMaterial] = useState<ListeningMaterial>({
    title: '未命名听力材料',
    audioUrl: '',
    script: '',
    segments: [],
  });
  const [currentMaterialId, setCurrentMaterialId] = useState<string | null>(null);

  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Auth Observer
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        // Fetch current user's profile info
        const userDoc = await getDoc(doc(db, 'users', u.uid));
        if (userDoc.exists()) {
          setUsersMap(prev => ({ ...prev, [u.uid]: userDoc.data().username || userDoc.data().email }));
        }

        // Check if user is admin via DB or hardcoded developer email
        const adminDoc = await getDoc(doc(db, 'admins', u.uid));
        const isDeveloper = u.email === 'jerrylee086@gmail.com';
        const adminStatus = adminDoc.exists() || isDeveloper;
        setIsAdmin(adminStatus);
        setShowAuthOverlay(false);

        // Fetch all users for attribution in the shared library
        try {
          const usersSnap = await getDocs(collection(db, 'users'));
          const map: Record<string, string> = {};
          usersSnap.forEach(doc => {
            map[doc.id] = doc.data().username || doc.data().email;
          });
          setUsersMap(map);
        } catch (err) {
          console.error("Failed to fetch users map", err);
        }
      } else {
        setMaterials([]);
        setCurrentMaterialId(null);
        setIsAdmin(false);
        setUsersMap({});
      }
    });
    return unsubscribe;
  }, []);

  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [editingUserUid, setEditingUserUid] = useState<string | null>(null);
  const [editingUserValue, setEditingUserValue] = useState('');

  // Special One-time Cleanup for 'jerry' user as requested
  useEffect(() => {
    if (!isAdmin || !user) return;
    
    const cleanupJerry = async () => {
      try {
        const usersSnap = await getDocs(collection(db, 'users'));
        let targetUid = '';
        usersSnap.forEach(d => {
          if (d.data().username?.toLowerCase() === 'jerry') {
            targetUid = d.id;
          }
        });

        if (targetUid) {
          console.log("Cleanup: Found jerry user with UID", targetUid);
          // Delete all materials
          const mSnap = await getDocs(query(collection(db, 'materials'), where('ownerId', '==', targetUid)));
          const mDeletes = mSnap.docs.map(d => deleteDoc(d.ref));
          await Promise.all(mDeletes);
          
          // Delete user and admin
          await deleteDoc(doc(db, 'users', targetUid));
          await deleteDoc(doc(db, 'admins', targetUid));
          console.log("Cleanup: Success");
        }
      } catch (err) {
        console.error("Cleanup Error", err);
      }
    };
    cleanupJerry();
  }, [isAdmin, user]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setIsLoggingIn(true);
    
    const username = authUsername.trim();
    const internalEmail = `${username.toLowerCase()}@echomaster.local`;

    try {
      // 1. Attempt login first
      try {
        await signInWithEmailAndPassword(auth, internalEmail, authPassword);
      } catch (err: any) {
        // 2. Special Bootstrap Logic: If login fails and it's the designated admin account
        if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
          if ((username === 'admin' && authPassword === 'sdeducation') || (username === 'jerrylee086' && authPassword === 'sdeducation')) {
            // Try to register as the first admin
            try {
              const res = await createUserWithEmailAndPassword(auth, internalEmail, authPassword);
              await setDoc(doc(db, 'users', res.user.uid), {
                username: username,
                email: internalEmail,
                createdAt: serverTimestamp(),
                role: 'admin'
              });
              await setDoc(doc(db, 'admins', res.user.uid), { assignedAt: serverTimestamp() });
              setIsAdmin(true);
              setShowAuthOverlay(false);
              return;
            } catch (regErr: any) {
              // If registration fails with "already in use", someone already is admin
              if (regErr.code === 'auth/email-already-in-use') {
                setAuthError('用户名或密码错误。');
                return;
              }
              throw regErr;
            }
          }
        }
        throw err;
      }
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
        setAuthError('用户名或密码错误');
      } else if (err.code === 'auth/operation-not-allowed') {
        setAuthError('错误：请在 Firebase 控制台启用 "Email/Password" 登录。');
      } else {
        setAuthError(err.message);
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const createInternalUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !user) return;
    setIsCreatingUser(true);
    setAdminError('');

    const targetEmail = `${newUserName.toLowerCase().trim()}@echomaster.local`;
    
    try {
      // Use secondary auth instance to create the user without affecting current login
      const secondaryAuth = getSecondaryAuth();
      const res = await createUserWithEmailAndPassword(secondaryAuth, targetEmail, newUserPassword);
      
      if (res.user) {
        await setDoc(doc(db, 'users', res.user.uid), {
          username: newUserName.trim(),
          email: targetEmail,
          createdAt: serverTimestamp(),
          role: 'user'
        });
        
        // Wait briefly for firestore sync, then sign out secondary user 
        // to keep the environment clean for the next creation
        await secondaryAuth.signOut();
      }
      
      alert(`用户 ${newUserName} 创建成功！可以使用该账号直接登录。`);
      setNewUserName('');
      setNewUserPassword('');
      setShowAdminPanel(false);
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/email-already-in-use') {
        setAdminError('该用户名已存在');
      } else {
        setAdminError(err.message);
      }
    } finally {
      setIsCreatingUser(false);
    }
  };

  // Sync Materials from Firestore
  useEffect(() => {
    if (!user) return;
    
    // Everyone sees everything to allow a shared library
    const q = query(
      collection(db, 'materials'),
      orderBy('updatedAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ 
        id: doc.id, 
        ...doc.data() 
      } as ListeningMaterial & { id: string }));
      setMaterials(docs);
    });
    return unsubscribe;
  }, [user]);

  // Load selected material
  const selectMaterial = (m: ListeningMaterial & { id: string }) => {
    setMaterial(m);
    setCurrentMaterialId(m.id);
    setCurrentTime(0);
    setIsPlaying(false);
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.pause();
    }
    setMode('train');
  };

  // Create new material
  const createNewMaterial = () => {
    setMaterial({
      title: '未命名听力材料',
      audioUrl: '',
      script: '',
      segments: [],
    });
    setCurrentMaterialId(null);
    setMode('setup');
  };

  // Persistence: Load from localStorage on mount (as fallback for guest)
  useEffect(() => {
    if (user) return;
    const saved = localStorage.getItem('echomaster_material');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Do not load blob URLs as they are session-specific and invalid after reload
        if (parsed.audioUrl && parsed.audioUrl.startsWith('blob:')) {
          parsed.audioUrl = '';
        }
        setMaterial(parsed);
      } catch (e) {
        console.error("Persistence Load Error", e);
      }
    }
  }, [user]);

  // Cloud Sync: Save function
  // Persistence: Save to local
  const manualSaveLocal = () => {
    try {
      const sanitizedMaterial = {
        title: material.title,
        audioUrl: material.audioUrl.startsWith('blob:') ? '' : material.audioUrl,
        script: material.script,
        segments: material.segments.map(s => ({
          id: s.id,
          label: s.label,
          startTime: s.startTime,
          endTime: s.endTime,
          subtitle: s.subtitle || ''
        }))
      };
      localStorage.setItem('echomaster_material', JSON.stringify(sanitizedMaterial));
      setLastSaved(new Date().toLocaleTimeString());
    } catch (e) {
      console.error("LocalStorage Save Error");
    }
  };

  // Cloud Sync: Save function
  const manualSave = async () => {
    if (!user) {
      manualSaveLocal();
      return;
    }

    setIsSyncing(true);
    try {
      // 1. Sanitize material data to exclude internal fields like 'id' from the document body
      // Ensure segments are clean and have all necessary fields
      const sanitizedSegments = material.segments.map(seg => ({
        id: seg.id,
        label: seg.label,
        startTime: seg.startTime,
        endTime: seg.endTime,
        subtitle: seg.subtitle || ''
      }));

      const dataToSave = {
        title: material.title || '未命名听力材料',
        // Audio is not synced to cloud per user request
        audioUrl: '', 
        script: material.script || '',
        segments: sanitizedSegments,
        updatedAt: serverTimestamp()
      };

      if (currentMaterialId) {
        const ref = doc(db, 'materials', currentMaterialId);
        await updateDoc(ref, dataToSave);
      } else {
        const ref = await addDoc(collection(db, 'materials'), {
          ...dataToSave,
          ownerId: user.uid,
          createdAt: serverTimestamp(),
        });
        setCurrentMaterialId(ref.id);
        // Also update local material object to match
        setMaterial(prev => ({ ...prev })); 
      }
      setLastSaved(new Date().toLocaleTimeString());
    } catch (e) {
      console.error("Save Error", e);
      alert("保存失败：权限不足或网络异常");
    } finally {
      setIsSyncing(false);
    }
  };

  // Auto-save debounced
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!user) {
        if (material.audioUrl || material.script || material.segments.length > 0) {
          const sanitizedMaterial = {
            title: material.title,
            audioUrl: material.audioUrl.startsWith('blob:') ? '' : material.audioUrl,
            script: material.script,
            segments: material.segments.map(s => ({
              id: s.id,
              label: s.label,
              startTime: s.startTime,
              endTime: s.endTime,
              subtitle: s.subtitle || ''
            }))
          };
          localStorage.setItem('echomaster_material', JSON.stringify(sanitizedMaterial));
        }
      } else if (currentMaterialId) {
        // Auto-update in cloud if we have an ID
        const sanitizedSegments = material.segments.map(seg => ({
          id: seg.id,
          label: seg.label,
          startTime: seg.startTime,
          endTime: seg.endTime,
          subtitle: seg.subtitle || ''
        }));

        const dataToSave = {
          title: material.title || '未命名听力材料',
          // Audio is not synced to cloud
          audioUrl: '', 
          script: material.script || '',
          segments: sanitizedSegments,
          updatedAt: serverTimestamp()
        };

        const ref = doc(db, 'materials', currentMaterialId);
        updateDoc(ref, dataToSave).catch(e => {
          if (e.code !== 'permission-denied') {
            console.error("Auto Sync Error", e);
          }
        });
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [material, user, currentMaterialId]);

  const [setupOption, setSetupOption] = useState<'new' | 'existing'>('new');
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number | null>(null);
  const [showSubtitles, setShowSubtitles] = useState(true);
  const [syncScroll, setSyncScroll] = useState(true);
  const transcriptRef = useRef<HTMLDivElement>(null);

  // Handle audio upload
  const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Local preview only - No cloud upload per user request
      const localUrl = URL.createObjectURL(file);
      setMaterial(prev => ({ ...prev, audioUrl: localUrl }));
    }
  };

  // Playback Control
  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const skip = (seconds: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime += seconds;
    }
  };

  // Auto-segmentation helper (based on time markers in text like [00:12])
  const extractSegmentsFromScript = () => {
    const regex = /\[(\d{1,2}):(\d{2})\]/g;
    const matches = Array.from(material.script.matchAll(regex));
    if (matches.length === 0) return;

    const newSegments: AudioSegment[] = matches.map((match, index) => {
      const startSec = parseInt(match[1]) * 60 + parseInt(match[2]);
      const nextMatch = matches[index + 1];
      const endSec = nextMatch 
        ? parseInt(nextMatch[1]) * 60 + parseInt(nextMatch[2]) 
        : duration || startSec + 30;
      
      // Get text between this timestamp and next
      const startIndex = match.index! + match[0].length;
      const endIndex = nextMatch ? nextMatch.index : material.script.length;
      const content = material.script.substring(startIndex, endIndex).trim();

      return {
        id: crypto.randomUUID(),
        label: `题目 ${index + 1}`,
        startTime: startSec,
        endTime: endSec,
        subtitle: content
      };
    });
    setMaterial(prev => ({ ...prev, segments: newSegments }));
  };

  // 1. Clear all segments with a safer implementation
  const clearAllSegments = () => {
    setMaterial(prev => ({
      ...prev,
      segments: []
    }));
    setActiveSegmentIndex(null);
    setCurrentTime(0); // Reset time to start to ensure clean state
    if (audioRef.current) audioRef.current.currentTime = 0;
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      
      // Check for segment changes in training mode
      if (mode === 'train') {
        const currentIdx = material.segments.findIndex(
          seg => audio.currentTime >= seg.startTime && audio.currentTime < seg.endTime
        );
        if (currentIdx !== activeSegmentIndex) {
          setActiveSegmentIndex(currentIdx === -1 ? null : currentIdx);
        }
      }
    };

    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('play', () => setIsPlaying(true));
    audio.addEventListener('pause', () => setIsPlaying(false));

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('play', () => setIsPlaying(true));
      audio.removeEventListener('pause', () => setIsPlaying(false));
    };
  }, [material.segments, material.audioUrl, mode, activeSegmentIndex]);

  // Handle auto-scroll to active segment
  useEffect(() => {
    if (mode === 'train' && syncScroll && activeSegmentIndex !== null && transcriptRef.current) {
      const activeElement = transcriptRef.current.querySelector(`[data-segment-index="${activeSegmentIndex}"]`);
      if (activeElement) {
        activeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [activeSegmentIndex, mode, syncScroll]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed]);

  const formatTime = (time: number) => {
    return `${Math.floor(time)}s`;
  };

  // Helper to render script with highlighting
  const renderTranscript = (onlyActive: boolean = false) => {
    let items = material.segments.map((seg, idx) => ({
      index: idx,
      text: seg.subtitle || '',
      startTime: seg.startTime,
      endTime: seg.endTime
    }));

    if (onlyActive && activeSegmentIndex !== null) {
      items = [items[activeSegmentIndex]];
    }

    if (items.length === 0 || (onlyActive && activeSegmentIndex === null)) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-slate-600 italic py-10 opacity-40">
          <BookOpen size={48} className="mb-4" />
          <p>{onlyActive ? "点击播放题目查看内容" : "暂无分段内容"}</p>
        </div>
      );
    }
    
    return (
      <div className={cn("flex flex-col w-full", onlyActive ? "gap-4" : "gap-12 py-10")}>
        {items.map((item, idx) => {
          const isActive = onlyActive ? true : item.index === activeSegmentIndex;
          // Preserve line breaks by splitting by newline first
          const lines = item.text.split('\n');
          const duration = item.endTime - item.startTime;
          
          // Calculate cumulative word count for highlighting across lines if needed
          // But for simplicity, we can just highlight based on time relative to this segment
          const totalWords = item.text.split(/\s+/).filter(Boolean).length;
          let currentWordGlobalIdx = 0;

          return (
            <motion.div 
              key={item.index}
              data-segment-index={item.index}
              initial={false}
              animate={{ 
                opacity: showSubtitles ? (isActive ? 1 : 0.3) : 0,
                x: isActive ? 4 : 0,
              }}
              transition={{ type: 'spring', stiffness: 200, damping: 25 }}
              className={cn(
                "w-full text-left transition-all duration-500 whitespace-pre-wrap",
                onlyActive ? "px-0" : "px-0 py-2",
                isActive ? "text-white" : "text-slate-500"
              )}
            >
              {lines.map((line, lIdx) => {
                const words = line.split(/(\s+)/); // Keep the spaces to maintain formatting
                return (
                  <div key={lIdx} className="flex flex-wrap">
                    {words.map((word, wIdx) => {
                      if (word.trim() === '') return <span key={wIdx}>{word}</span>;
                      
                      const wordIdxInLine = currentWordGlobalIdx++;
                      let isWordActive = false;
                      if (isActive && duration > 0 && totalWords > 0) {
                        const elapsed = currentTime - item.startTime;
                        const wordProgress = (elapsed / duration) * totalWords;
                        isWordActive = wordIdxInLine <= wordProgress;
                      }

                      return (
                        <motion.span
                          key={wIdx}
                          initial={false}
                          animate={{
                            color: isActive && isWordActive ? '#60a5fa' : 'inherit',
                            scale: isActive && isWordActive ? 1.05 : 1,
                          }}
                          className={cn(
                            "text-base md:text-lg font-medium inline-block",
                            isActive && isWordActive ? "font-bold" : ""
                          )}
                        >
                          {word}
                        </motion.span>
                      );
                    })}
                  </div>
                );
              })}
            </motion.div>
          );
        })}
      </div>
    );
  };

  const [galleryUserFilter, setGalleryUserFilter] = useState<string>('all');

  const filteredMaterials = useMemo(() => {
    if (!isAdmin || galleryUserFilter === 'all') return materials;
    return materials.filter(m => m.ownerId === galleryUserFilter);
  }, [materials, isAdmin, galleryUserFilter]);

  return (
    <div className="min-h-screen font-sans selection:bg-blue-500/30 selection:text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 glass border-b border-white/10">
        <div className="max-w-7xl mx-auto px-10 h-24 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center text-white font-black text-xl shadow-lg shadow-blue-600/30">
              E
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-white leading-none">EchoMaster Pro</h1>
              <p className="text-[12px] text-blue-400 font-bold uppercase tracking-[0.3em] mt-1.5">High School Listening Lab</p>
            </div>
          </div>

          <nav className="flex items-center gap-3">
            <button 
              onClick={() => setMode('setup')}
              className={cn(
                "px-4 py-2.5 text-sm font-medium transition-all rounded-xl flex items-center gap-2",
                mode === 'setup' ? "bg-white/10 text-white shadow-lg" : "text-slate-400 hover:text-white"
              )}
            >
              <HomeIcon size={16} /> 首页
            </button>

            {user && (
              <button 
                onClick={() => setMode('gallery')}
                className={cn(
                  "px-4 py-2.5 text-sm font-medium transition-all rounded-xl flex items-center gap-2",
                  mode === 'gallery' ? "bg-blue-600 text-white shadow-lg" : "btn-glass text-slate-300"
                )}
              >
                <FolderOpen size={16} /> 库
              </button>
            )}

            {currentMaterialId && (
              <>
                <div className="w-[1px] h-6 bg-white/10 mx-1" />
                <div className="flex bg-white/5 p-1 rounded-xl border border-white/10">
                  <button 
                    onClick={() => setMode('edit')}
                    className={cn(
                      "px-4 py-1.5 text-xs font-bold transition-all rounded-lg flex items-center gap-2",
                      mode === 'edit' ? "bg-blue-600 text-white shadow-lg" : "text-slate-500 hover:text-white"
                    )}
                  >
                    <Settings2 size={14} /> 编辑
                  </button>
                  <button 
                    onClick={() => setMode('train')}
                    className={cn(
                      "px-4 py-1.5 text-xs font-bold transition-all rounded-lg flex items-center gap-2",
                      mode === 'train' ? "bg-blue-600 text-white shadow-lg" : "text-slate-500 hover:text-white"
                    )}
                  >
                    <BookOpen size={14} /> 训练
                  </button>
                </div>
              </>
            )}
            
            <div className="w-[1px] h-6 bg-white/10 mx-1" />

            {lastSaved && (
              <span className="text-[10px] font-bold text-green-500 uppercase tracking-tighter opacity-70 hidden md:inline">
                {lastSaved} {isSyncing ? "同步中..." : "已保存"}
              </span>
            )}
            <button 
              onClick={manualSave}
              className="btn-glass p-2.5 rounded-xl text-blue-400 hover:text-white transition-all group"
              title="保存到云端"
            >
              <Save size={18} className={cn("group-active:scale-95", isSyncing && "animate-pulse")} />
            </button>
            {isAdmin && (
              <button 
                onClick={() => setShowAdminPanel(true)}
                className="px-4 py-2.5 text-sm font-medium transition-all rounded-xl flex items-center gap-2 text-yellow-500 hover:bg-yellow-500/10"
              >
                <ShieldCheck size={16} /> 管理用户
              </button>
            )}

            <div className="w-[1px] h-6 bg-white/10 mx-1" />
            
            {user ? (
               <div className="flex items-center gap-3 pl-2 border-l border-white/5">
                 <div className="flex flex-col items-end">
                   <div className="flex items-center gap-2">
                     <span className="text-xs font-bold text-white tracking-tight">{usersMap[user.uid] || user.displayName || '用户'}</span>
                     {isAdmin && <ShieldCheck size={14} className="text-yellow-500" />}
                   </div>
                   <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">{isAdmin ? '管理员' : '普通用户'}</span>
                 </div>
                 <div className="w-8 h-8 rounded-full bg-blue-600/20 flex items-center justify-center text-blue-400 border border-white/10 shrink-0">
                   <UserIcon size={16} />
                 </div>
                 <button onClick={() => signOut()} className="text-slate-500 hover:text-red-400 transition-colors">
                   <LogOut size={18} />
                 </button>
               </div>
            ) : (
              <button 
                onClick={() => setShowAuthOverlay(true)}
                className="flex items-center gap-2 px-4 py-2 bg-white text-black rounded-xl font-bold text-sm hover:bg-slate-100 transition-all active:scale-95"
              >
                <LogIn size={16} /> 登录同步
              </button>
            )}
          </nav>
        </div>
      </header>

      <AnimatePresence>
        {showAuthOverlay && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="glass p-10 rounded-[32px] w-full max-w-md space-y-8 relative"
            >
              <button 
                onClick={() => setShowAuthOverlay(false)}
                className="absolute top-6 right-6 text-slate-500 hover:text-white"
              >
                <Plus size={24} className="rotate-45" />
              </button>

              <div className="text-center space-y-2">
                <h3 className="text-2xl font-bold text-white">账号登录</h3>
                <p className="text-sm text-slate-400">输入用户名和密码登录听力系统</p>
              </div>

              <form onSubmit={handleAuth} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-2">用户名</label>
                  <input 
                    type="text"
                    required
                    value={authUsername}
                    onChange={(e) => setAuthUsername(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-white focus:outline-none focus:border-blue-500/50"
                    placeholder="例如: admin"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-2">密码</label>
                  <input 
                    type="password"
                    required
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-white focus:outline-none focus:border-blue-500/50"
                    placeholder="••••••••"
                  />
                </div>
                
                {authError && <p className="text-xs text-red-500 text-center">{authError}</p>}

                <button 
                  type="submit"
                  disabled={isLoggingIn}
                  className="w-full h-14 bg-blue-600 text-white rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/20 active:scale-[0.98] disabled:opacity-50"
                >
                  <LogIn size={20} /> {isLoggingIn ? '登录中...' : '登录'}
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}

        {showAdminPanel && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="glass p-8 rounded-[32px] w-full max-w-2xl max-h-[85vh] flex flex-col relative overflow-hidden"
            >
              <button 
                onClick={() => setShowAdminPanel(false)}
                className="absolute top-6 right-6 text-slate-500 hover:text-white z-20"
              >
                <Plus size={24} className="rotate-45" />
              </button>

              <div className="flex-grow overflow-y-auto custom-scrollbar pr-2 space-y-10">
                <div className="text-center space-y-2 mt-4">
                  <h3 className="text-2xl font-bold text-white text-yellow-500">管理员控制台</h3>
                  <p className="text-sm text-slate-400">管理用户账号及材料库权限</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                  {/* Left: Create User */}
                  <div className="space-y-6">
                    <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest border-b border-white/5 pb-2">创建新账号</h4>
                    <form onSubmit={createInternalUser} className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-2">用户名</label>
                        <input 
                          type="text"
                          required
                          value={newUserName}
                          onChange={(e) => setNewUserName(e.target.value)}
                          className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-white text-sm focus:outline-none focus:border-blue-500/50"
                          placeholder="姓名拼音"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-2">初始密码</label>
                        <input 
                          type="text"
                          required
                          value={newUserPassword}
                          onChange={(e) => setNewUserPassword(e.target.value)}
                          className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-white text-sm focus:outline-none focus:border-blue-500/50"
                          placeholder="初始密码"
                        />
                      </div>
                      
                      {adminError && <p className="text-xs text-red-500">{adminError}</p>}

                      <button 
                        type="submit"
                        disabled={isCreatingUser}
                        className="w-full h-12 bg-yellow-600 text-white rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-yellow-700 transition-all shadow-lg shadow-yellow-600/20 active:scale-[0.98] disabled:opacity-50"
                      >
                        <Plus size={18} /> {isCreatingUser ? '创建中...' : '确认创建'}
                      </button>
                    </form>
                  </div>

                  {/* Right: User List */}
                  <div className="space-y-6">
                    <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest border-b border-white/5 pb-2">现有账号 ({Object.keys(usersMap).length})</h4>
                    <div className="space-y-3">
                      {Object.entries(usersMap).map(([uid, name]) => (
                        <div key={uid} className="flex items-center justify-between p-3 bg-white/5 rounded-2xl border border-white/5 group">
                          {editingUserUid === uid ? (
                            <div className="flex items-center gap-2 w-full">
                              <input 
                                autoFocus
                                value={editingUserValue}
                                onChange={(e) => setEditingUserValue(e.target.value)}
                                onKeyDown={async (e) => {
                                  if (e.key === 'Enter' && editingUserValue.trim()) {
                                    try {
                                      await updateDoc(doc(db, 'users', uid), { username: editingUserValue.trim() });
                                      setUsersMap(prev => ({ ...prev, [uid]: editingUserValue.trim() }));
                                      setEditingUserUid(null);
                                    } catch (err) {
                                      alert("更新失败");
                                    }
                                  }
                                }}
                                className="bg-slate-800 border-none rounded-lg px-3 py-1 text-sm text-white w-full"
                              />
                              <button onClick={() => setEditingUserUid(null)} className="text-xs text-slate-500 p-1">取消</button>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-500">
                                  {name.charAt(0).toUpperCase()}
                                </div>
                                <span className="text-sm font-bold text-slate-300">{name}</span>
                              </div>
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                <button 
                                  onClick={() => {
                                    setEditingUserUid(uid);
                                    setEditingUserValue(name);
                                  }}
                                  className="p-2 text-slate-500 hover:text-blue-400"
                                  title="修改用户名"
                                >
                                  <Edit3 size={14} />
                                </button>
                                <button 
                                  onClick={async () => {
                                    if (confirm(`⚠️ 极其重要：确定要彻底删除用户 [${name}] 及其名下的【所有】听力材料文件夹吗？此操作不可恢复！`)) {
                                      try {
                                        // 1. Delete all materials owned by this user
                                        const q = query(collection(db, 'materials'), where('ownerId', '==', uid));
                                        const querySnapshot = await getDocs(q);
                                        const deletePromises = querySnapshot.docs.map(d => deleteDoc(d.ref));
                                        await Promise.all(deletePromises);

                                        // 2. Delete user doc
                                        await deleteDoc(doc(db, 'users', uid));
                                        
                                        // 3. Delete admin status
                                        await deleteDoc(doc(db, 'admins', uid));

                                        setUsersMap(prev => {
                                          const next = { ...prev };
                                          delete next[uid];
                                          return next;
                                        });
                                        alert(`用户 ${name} 及其所有内容已清除`);
                                      } catch (err) {
                                        alert("一键删除失败，请检查网络或权限");
                                        console.error(err);
                                      }
                                    }
                                  }}
                                  className="p-2 text-red-500/50 hover:text-red-500"
                                  title="一键彻底注销(删人+删内容)"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="max-w-7xl mx-auto px-10 py-12">
        <AnimatePresence mode="wait">
          {mode === 'gallery' && (
            <motion.div 
               key="gallery"
               initial={{ opacity: 0, y: 20 }}
               animate={{ opacity: 1, y: 0 }}
               exit={{ opacity: 0, y: -20 }}
               className="space-y-10"
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-3xl font-black text-white tracking-tighter">材料库</h2>
                  <p className="text-slate-500 text-sm mt-1">管理你的所有听力练习内容</p>
                </div>
                
                <div className="flex items-center gap-4">
                  {isAdmin && (
                    <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-2xl px-4 py-2">
                       <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">筛选账户:</span>
                       <select 
                         value={galleryUserFilter}
                         onChange={(e) => setGalleryUserFilter(e.target.value)}
                         className="bg-transparent border-none text-xs font-bold text-blue-400 focus:outline-none cursor-pointer"
                       >
                         <option value="all" className="bg-slate-900 text-white">全部材料</option>
                         {Object.entries(usersMap).map(([uid, name]) => (
                           <option key={uid} value={uid} className="bg-slate-900 text-white">{name}</option>
                         ))}
                       </select>
                    </div>
                  )}
                  <button 
                    onClick={createNewMaterial}
                    className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-2xl font-bold shadow-xl shadow-blue-600/20 hover:scale-105 transition-all"
                  >
                    <Plus size={20} /> 新建材料
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <AnimatePresence>
                  {filteredMaterials.map((m) => {
                    const ownerName = usersMap[m.ownerId || ''] || '未知用户';
                    return (
                      <motion.div 
                        key={m.id}
                        layout
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="glass p-6 rounded-[32px] border-white/5 hover:border-blue-500/30 transition-all group flex flex-col justify-between h-[200px] relative overflow-hidden"
                      >
                        {m.ownerId && (
                          <div className={cn(
                            "absolute top-0 right-0 px-3 py-1 text-[8px] font-black uppercase tracking-widest rounded-bl-xl border-l border-b transition-all",
                            user && m.ownerId === user.uid 
                              ? "bg-green-500/10 text-green-400 border-green-500/20" 
                              : "bg-blue-500/10 text-blue-400 border-blue-500/20"
                          )}>
                            {user && m.ownerId === user.uid ? "我的材料" : `来自: ${ownerName}`}
                          </div>
                        )}

                        <div>
                          <div className="flex items-start justify-between">
                            <h3 className="font-bold text-white text-lg line-clamp-2 pr-4">{m.title}</h3>
                               {(isAdmin || (user && m.ownerId === user.uid)) && (
                                 <div className="flex items-center gap-1">
                                  <button 
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      const newTitle = prompt("重命名材料库:", m.title);
                                      if (newTitle && newTitle.trim() && newTitle !== m.title) {
                                        try {
                                          await updateDoc(doc(db, 'materials', m.id), { title: newTitle.trim() });
                                        } catch (err) {
                                          alert("重命名失败");
                                        }
                                      }
                                    }}
                                    className="p-2 text-slate-500 hover:text-blue-400 transition-colors bg-white/5 rounded-xl border border-white/10 hover:border-blue-500/30 z-10 shrink-0"
                                    title="重命名"
                                  >
                                    <Edit3 size={16} />
                                  </button>
                                  <button 
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      if (confirm(`确定要彻底删除 [${m.title}] 文件夹及其所有配置吗？`)) {
                                        try {
                                          await deleteDoc(doc(db, 'materials', m.id));
                                        } catch (err: any) {
                                          console.error("Delete failed", err);
                                          alert("删除失败：" + (err.message || '权限不足'));
                                        }
                                      }
                                    }}
                                    className="p-2 text-white hover:text-red-500 transition-colors bg-red-500/20 rounded-xl border border-red-500/30 hover:border-red-500/50 z-10 shrink-0"
                                    title="彻底删除"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              )}
                          </div>
                          <div className="flex items-center gap-4 mt-2">
                             <p className="text-[10px] text-slate-500 flex items-center gap-1.5 uppercase font-bold tracking-wider">
                               <Clock size={12} /> {m.segments?.length || 0} SEGS
                             </p>
                             <p className={cn(
                               "text-[10px] flex items-center gap-1.5 uppercase font-bold tracking-wider",
                               !m.audioUrl ? "text-yellow-500/60" : "text-green-500/60"
                             )}>
                               {!m.audioUrl ? "需加载音频" : "已关联音频"}
                             </p>
                          </div>
                        </div>

                          <div className="flex items-center gap-3 pt-4 border-t border-white/5">
                            {m.audioUrl ? (
                              <button 
                                onClick={() => selectMaterial(m)}
                                className="text-xs font-bold text-blue-400 flex items-center gap-1 group-hover:gap-2 transition-all h-9"
                              >
                                开始训练 <ArrowRight size={14} />
                              </button>
                            ) : (
                              <label className="text-xs font-bold text-yellow-500 flex items-center gap-1 hover:text-yellow-400 cursor-pointer transition-all bg-yellow-500/5 px-3 py-2 rounded-xl border border-yellow-500/10">
                                <Upload size={14} /> 导入音频
                                <input 
                                  type="file" 
                                  accept="audio/*" 
                                  className="hidden" 
                                  onChange={async (e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                      const localUrl = URL.createObjectURL(file);
                                      try {
                                        // Update the local state immediately
                                        const updatedMaterials = materials.map(mat => 
                                          mat.id === m.id ? { ...mat, audioUrl: localUrl } : mat
                                        );
                                        setMaterials(updatedMaterials);
                                        // And open the training mode with this material
                                        selectMaterial({ ...m, audioUrl: localUrl });
                                      } catch (err) {
                                        console.error("Local load failed", err);
                                      }
                                    }
                                  }} 
                                />
                              </label>
                            )}
                            <button 
                              onClick={() => {
                                setMaterial(m);
                                setCurrentMaterialId(m.id);
                                setMode('edit');
                              }}
                              className="text-xs font-bold text-slate-500 hover:text-white ml-auto"
                            >
                              配置
                            </button>
                          </div>
                      </motion.div>
                    );
                  })}
                  {materials.length === 0 && (
                    <div className="col-span-full py-20 flex flex-col items-center justify-center text-slate-600 border border-dashed border-white/10 rounded-[40px]">
                      <FolderOpen size={48} className="mb-4 opacity-20" />
                      <p className="text-sm">暂无材料，点击右上角新建</p>
                    </div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}

          {mode === 'setup' && (
            <motion.div 
              key="setup"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="max-w-2xl mx-auto space-y-8"
            >
              <div className="glass p-10 rounded-[32px] space-y-8">
                <div className="space-y-6">
                  <h2 className="text-4xl font-bold text-white">开始新的听力任务</h2>
                  
                  {user && (
                    <div className="flex bg-white/5 p-1.5 rounded-2xl border border-white/10 h-16">
                      <button 
                        onClick={() => {
                          setSetupOption('new');
                          setCurrentMaterialId(null);
                          setMaterial({ title: '未命名听力材料', audioUrl: '', script: '', segments: [] });
                        }}
                        className={cn(
                          "flex-1 text-base font-bold rounded-xl transition-all",
                          setupOption === 'new' ? "bg-blue-600 text-white shadow-lg" : "text-slate-500 hover:text-white"
                        )}
                      >
                        建立新材料库
                      </button>
                      <button 
                        onClick={() => setSetupOption('existing')}
                        className={cn(
                          "flex-1 text-base font-bold rounded-xl transition-all",
                          setupOption === 'existing' ? "bg-blue-600 text-white shadow-lg" : "text-slate-500 hover:text-white"
                        )}
                      >
                        选择已有材料
                      </button>
                    </div>
                  )}

                  {setupOption === 'new' ? (
                    <div className="space-y-2">
                       <input 
                        value={material.title}
                        onChange={(e) => setMaterial(prev => ({ ...prev, title: e.target.value }))}
                        placeholder="输入材料库名称 (例如: 2024高考模拟一)"
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500/50"
                      />
                      <p className="text-slate-400 text-xs">直接输入名称、上传音频及脚本即可建立新库。</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <select 
                        value={currentMaterialId || ''}
                        onChange={(e) => {
                          const selected = materials.find(m => m.id === e.target.value);
                          if (selected) {
                            setMaterial(selected);
                            setCurrentMaterialId(selected.id);
                          }
                        }}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500/50 appearance-none cursor-pointer"
                      >
                        <option value="" disabled className="bg-slate-900 text-slate-500">选择已有库材料...</option>
                        {materials.map(m => (
                          <option key={m.id} value={m.id} className="bg-slate-900 text-white">
                            {m.title} {isAdmin ? ` - [${usersMap[m.ownerId || ''] || '未知'}]` : ''}
                          </option>
                        ))}
                      </select>
                      <p className="text-slate-400 text-xs">选择已有材料库后，可以重新上传音频进行内容替换。</p>
                    </div>
                  )}
                </div>

                <div className="space-y-6">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-3">音频文件 (MP3/WAV)</label>
                    <div className="relative group">
                      <input 
                        type="file" 
                        accept="audio/*" 
                        onChange={handleAudioUpload}
                        disabled={isUploading}
                        className={cn(
                          "absolute inset-0 w-full h-full opacity-0 z-10",
                          isUploading ? "cursor-wait" : "cursor-pointer"
                        )}
                      />
                      <div className={cn(
                        "border border-white/10 rounded-2xl p-10 flex flex-col items-center justify-center gap-4 bg-white/5 transition-all",
                        !isUploading && "hover:bg-white/10 group-hover:border-blue-500/50"
                      )}>
                        <div className={cn(
                          "w-14 h-14 bg-white/5 rounded-2xl flex items-center justify-center text-slate-400 transition-all shadow-inner",
                          isUploading ? "animate-pulse bg-blue-600/20 text-blue-400" : "group-hover:bg-blue-600 group-hover:text-white"
                        )}>
                          <ListMusic size={28} />
                        </div>
                        <span className="text-sm font-medium text-slate-300">
                          {isUploading ? "正在同步音频到云端..." : (material.audioUrl ? "音频已成功就绪 ✅" : "点击或拖拽上传音频")}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between border-b border-white/5 pb-2">
                       <div className="flex gap-6">
                         <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-400">
                           软件使用简易说明
                         </div>
                       </div>
                    </div>

                    <div className="min-h-[250px]">
                      <div className="glass-dark border border-white/10 rounded-3xl p-8 space-y-8 text-lg text-slate-300 leading-relaxed shadow-2xl">
                        <div className="space-y-3">
                          <h4 className="text-white text-xl font-bold flex items-center gap-3 font-display"><CheckCircle2 size={24} className="text-blue-400" /> 1级：上传你的听力音频</h4>
                          <p className="pl-9 text-slate-400 text-base">点击上方的蓝框，把你的 MP3 听力文件传上来。传好后会提示“就绪”。</p>
                        </div>
                        
                        <div className="space-y-3">
                          <h4 className="text-white text-xl font-bold flex items-center gap-3 font-display"><ArrowRight size={24} className="text-blue-400" /> 2级：标记你想练的题目</h4>
                          <p className="pl-9 text-slate-400 text-base">点“下一步”，播放到某道题开始时，点一下“快速切割”。您可以给这题起个名字（比如：第1题）。</p>
                        </div>

                        <div className="space-y-3">
                          <h4 className="text-white text-xl font-bold flex items-center gap-3 font-display"><Play size={24} className="text-blue-400" /> 3级：开启无限循环模式</h4>
                          <p className="pl-9 text-slate-400 text-base">点“保存并训练”，想练哪题点哪题。还可以调慢速度，直到您完全听清每一个词！</p>
                        </div>

                        <div className="p-6 bg-blue-600/10 border border-blue-500/30 rounded-2xl">
                          <p className="text-sm text-blue-300 font-bold">💡 提示：新手可以点击下方的“加载演示案例”先看一看是怎么用的。</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 space-y-3">
                    {currentMaterialId && material.segments.length > 0 && (
                      <button 
                        onClick={() => setMode('train')}
                        className="w-full h-14 bg-green-600 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-green-700 transition-all shadow-lg shadow-green-600/30"
                      >
                        直接开始训练 <Play size={20} />
                      </button>
                    )}

                    <button 
                      disabled={!material.audioUrl}
                      onClick={() => setMode('edit')}
                      className="w-full h-14 bg-blue-600 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-blue-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-600/30"
                    >
                      {currentMaterialId ? '修改配置/分段' : '下一步：配置分段'} <ArrowRight size={20} />
                    </button>

                    {(isAdmin || (user && material.ownerId === user.uid)) && currentMaterialId && (
                      <button 
                        onClick={async () => {
                          if (confirm('确定要【彻底删除】此材料库文件吗？')) {
                            try {
                              await deleteDoc(doc(db, 'materials', currentMaterialId));
                              setMode('gallery');
                              setCurrentMaterialId(null);
                              setMaterial({ title: '未命名听力材料', audioUrl: '', script: '', segments: [] });
                            } catch (err) {
                              console.error("Delete failed", err);
                              alert("删除失败。");
                            }
                          }
                        }}
                        className="w-full h-12 text-red-500 hover:text-white text-sm font-bold transition-all flex items-center justify-center gap-2 bg-red-500/5 hover:bg-red-600 rounded-2xl border border-red-500/10 shadow-lg shadow-red-500/10"
                      >
                        <Trash2 size={18} /> 彻底删除此材料库
                      </button>
                    )}

                    <button 
                      onClick={() => {
                        setMaterial({
                          title: '演示：日常对话听力练习 (CDN)',
                          audioUrl: 'https://cdn.pixabay.com/audio/2022/03/10/audio_c8c8a178af.mp3', // 这是一个环境谈话类的音频，非常适合听力练习演示
                          script: '',
                          segments: [
                            { id: '1', label: '1. 引入环节', startTime: 0, endTime: 11, subtitle: '（环境背景音：日常谈话与背景杂音）\n欢迎来到 EchoMaster 听力训练演示。' },
                            { id: '2', label: '2. 核心对话', startTime: 11, endTime: 25, subtitle: '**A**: Hi there! Can you help me with this?\n**B**: Sure, what do you need?\n**A**: I am looking for the main station.' },
                            { id: '3', label: '3. 详细解释', startTime: 25, endTime: 40, subtitle: '**B**: Oh, it is just two blocks down that way.\n**A**: Thank you so much!\n**B**: You are welcome, have a nice day!' },
                            { id: '4', label: '4. 练习结尾', startTime: 40, endTime: 55, subtitle: '（谈话逐渐减弱）\n这就是一个简单的分段示例，你可以点击下方的小卡片反复听这一段。' },
                          ]
                        });
                        setMode('edit');
                      }}
                      className="w-full h-14 btn-glass text-slate-300 rounded-2xl font-bold flex items-center justify-center gap-2"
                    >
                      点击：加载演示案例
                    </button>
                    <p className="mt-2 text-[10px] text-slate-500 text-center">提示：如演示音频加载失败，请尝试刷新或上传本地音频文件。</p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {mode === 'edit' && (
            <motion.div 
              key="edit"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              {/* Toolbar with Title for Edit Mode */}
              <div className="glass p-6 rounded-[32px] border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black text-blue-500 uppercase tracking-widest">Editing Folder:</span>
                    {isSyncing && <span className="text-[8px] font-bold text-blue-400/60 animate-pulse bg-blue-500/10 px-2 py-0.5 rounded-full uppercase tracking-widest">Syncing...</span>}
                  </div>
                  <input 
                    value={material.title}
                    onChange={(e) => setMaterial(p => ({ ...p, title: e.target.value }))}
                    className="text-2xl font-black tracking-tighter text-white bg-transparent border-none focus:outline-none focus:ring-0 p-0 w-full"
                    placeholder="输入文件夹名称..."
                  />
                </div>
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => setMode('gallery')}
                    className="px-6 py-3 bg-white/5 hover:bg-white/10 text-white rounded-2xl font-bold transition-all flex items-center gap-2 border border-white/10"
                  >
                    <ArrowLeft size={18} /> 返回材料库
                  </button>
                  <button 
                    onClick={() => setMode('train')}
                    className="px-6 py-3 bg-blue-600 text-white rounded-2xl font-bold shadow-xl shadow-blue-600/20 hover:scale-105 active:scale-95 transition-all flex items-center gap-2"
                  >
                    <Save size={18} /> 保存并训练
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              {/* Left: Player & Editor */}
              <div className="lg:col-span-4 space-y-6">
                <div className="glass p-6 rounded-[24px] space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-white flex items-center gap-2 text-sm tracking-tight"><Clock size={16} className="text-blue-400" /> 播放控制</h3>
                    <div className="flex gap-2">
                       <button 
                         onClick={clearAllSegments}
                         disabled={material.segments.length === 0}
                         className="text-[10px] font-bold text-red-500 hover:text-red-400 flex items-center gap-1.5 transition-all uppercase tracking-widest disabled:opacity-30 p-2 glass rounded-lg border-red-500/20 active:bg-red-500/10"
                       >
                         <Trash2 size={12} /> 全部清空
                       </button>
                       <button 
                         onClick={extractSegmentsFromScript}
                         className="text-[10px] font-bold text-blue-400 hover:text-blue-300 flex items-center gap-1.5 transition-colors uppercase tracking-widest"
                       >
                         <CheckCircle2 size={12} /> 同步脚本
                       </button>
                    </div>
                  </div>

                  <div className="bg-black/20 rounded-[20px] p-6 space-y-4 border border-white/5 shadow-inner">
                    <div className="space-y-2">
                       <div className="flex justify-between text-[10px] font-mono text-slate-500 tracking-widest">
                         <span className="text-blue-400">{formatTime(currentTime)}</span>
                         <span>{formatTime(duration)}</span>
                       </div>
                       <input 
                         type="range" 
                         min="0" 
                         max={duration} 
                         value={currentTime}
                         onChange={(e) => {
                           if (audioRef.current) audioRef.current.currentTime = parseFloat(e.target.value);
                         }}
                         className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-blue-500"
                       />
                    </div>

                    <div className="flex items-center justify-center gap-6">
                      <button onClick={() => skip(-10)} className="text-slate-500 hover:text-white transition-all active:scale-90"><Rewind size={20} /></button>
                      <button onClick={togglePlay} className="w-14 h-14 bg-blue-600 rounded-full flex items-center justify-center text-white shadow-lg hover:scale-105 active:scale-95 transition-all">
                        {isPlaying ? <Pause size={24} /> : <Play size={24} className="translate-x-1" />}
                      </button>
                      <button onClick={() => skip(10)} className="text-slate-500 hover:text-white transition-all active:scale-90"><FastForward size={20} /></button>
                    </div>

                    <div className="flex items-center gap-4 pt-4 border-t border-white/5">
                      <div className="flex flex-col gap-1">
                        <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">播放速度</span>
                        <span className="text-xs font-mono font-bold text-blue-400">{playbackSpeed.toFixed(1)}x</span>
                      </div>
                      <input 
                        type="range"
                        min="0.5"
                        max="2.5"
                        step="0.1"
                        value={playbackSpeed}
                        onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
                        className="flex-grow h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-blue-500"
                      />
                    </div>
                  </div>
                </div>

                <div className="glass p-6 rounded-[32px] space-y-6">
                  <h3 className="font-bold text-white flex items-center gap-2 text-sm tracking-tight"><BookOpen size={16} className="text-blue-400" /> 脚本预览</h3>
                  <div className="bg-black/20 rounded-[20px] p-6 text-slate-400 h-[500px] overflow-y-auto custom-scrollbar border border-white/5">
                    <div className="max-w-none">
                       {renderTranscript(true)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Right: Segments Management */}
              <div className="lg:col-span-8 flex flex-col h-full min-h-[600px]">
                <div className="glass p-8 rounded-[32px] flex flex-col flex-grow border-white/10">
                  <div className="flex items-center justify-between mb-8">
                    <h3 className="font-bold text-white tracking-tight">题目分段管理</h3>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => {
                          setMaterial(prev => {
                            const lastSegment = prev.segments[prev.segments.length - 1];
                            const startTime = lastSegment ? lastSegment.endTime : 0;
                            return {
                              ...prev,
                              segments: [...prev.segments, {
                                id: crypto.randomUUID(),
                                label: `题目 ${prev.segments.length + 1}`,
                                startTime: currentTime,
                                endTime: Math.min(currentTime + 5, duration),
                                subtitle: ''
                              }]
                            };
                          });
                        }}
                        title="在当前时间新增分段"
                        className="w-10 h-10 btn-glass rounded-xl flex items-center justify-center text-blue-400 border-blue-500/20"
                      >
                        <Plus size={20} />
                      </button>
                      <button 
                        onClick={() => {
                          setMaterial(prev => {
                            const newSegments = [...prev.segments];
                            if (newSegments.length > 0) {
                              const lastIdx = newSegments.length - 1;
                              // Update previous segment's end time to current time
                              newSegments[lastIdx].endTime = currentTime;
                            }
                            // Add new segment starting at current time
                            newSegments.push({
                              id: crypto.randomUUID(),
                              label: `题目 ${newSegments.length + 1}`,
                              startTime: currentTime,
                              endTime: Math.min(currentTime + 5, duration),
                              subtitle: ''
                            });
                            return { ...prev, segments: newSegments };
                          });
                        }}
                        title="手动切割（设当前时间为上段落结束及新段落开始）"
                        className="px-3 py-2 btn-glass rounded-xl text-xs font-bold text-blue-400 flex items-center gap-1 border-blue-500/20"
                      >
                        <RotateCcw size={14} className="rotate-90" /> 快速切割
                      </button>
                    </div>
                  </div>

                  <div className="flex-grow space-y-4 overflow-y-auto pr-2 custom-scrollbar">
                    {material.segments.map((seg, idx) => (
                      <div key={seg.id} className="p-4 bg-white/5 border border-white/5 rounded-2xl group hover:border-white/10 transition-all space-y-3">
                        <div className="flex items-center justify-between">
                          <input 
                            value={seg.label}
                            onChange={(e) => {
                              const newSegs = [...material.segments];
                              newSegs[idx].label = e.target.value;
                              setMaterial(p => ({ ...p, segments: newSegs }));
                            }}
                            className="text-sm font-bold bg-transparent border-none focus:outline-none focus:ring-0 text-white w-2/3"
                          />
                          <button 
                            onClick={() => {
                              setMaterial(p => {
                                const remaining = p.segments.filter(s => s.id !== seg.id);
                                const reindexed = remaining.map((s, i) => ({
                                  ...s,
                                  label: `题目 ${i + 1}`
                                }));
                                return { ...p, segments: reindexed };
                              });
                            }}
                            className="text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                        
                        <textarea
                          placeholder="输入本段字幕/内容..."
                          value={seg.subtitle || ''}
                          onChange={(e) => {
                            const newSegs = [...material.segments];
                            newSegs[idx].subtitle = e.target.value;
                            setMaterial(p => ({ ...p, segments: newSegs }));
                          }}
                          className="w-full bg-black/20 border border-white/5 rounded-lg p-4 text-sm text-slate-300 placeholder:text-slate-600 focus:border-blue-500/30 outline-none resize-none h-48"
                        />
                        <div className="flex items-center gap-4">
                          <div className="flex-grow grid grid-cols-2 gap-3 text-[10px] font-mono">
                             <div className="space-y-1.5">
                               <span className="text-slate-500 font-bold tracking-widest text-xs">START</span>
                               <input 
                                 type="number" step="1" 
                                 value={Math.floor(seg.startTime)}
                                 onChange={(e) => {
                                   const newSegs = [...material.segments];
                                   newSegs[idx].startTime = parseFloat(e.target.value);
                                   setMaterial(p => ({ ...p, segments: newSegs }));
                                 }}
                                 className="w-full p-3 bg-black/20 border border-white/10 rounded-xl text-white focus:border-blue-500/50 outline-none text-base"
                               />
                             </div>
                             <div className="space-y-1.5">
                               <span className="text-slate-500 font-bold tracking-widest text-xs">END</span>
                               <input 
                                 type="number" step="1"
                                 value={Math.floor(seg.endTime)} 
                                 onChange={(e) => {
                                   const newSegs = [...material.segments];
                                   newSegs[idx].endTime = parseFloat(e.target.value);
                                   setMaterial(p => ({ ...p, segments: newSegs }));
                                 }}
                                 className="w-full p-3 bg-black/20 border border-white/10 rounded-xl text-white focus:border-blue-500/50 outline-none text-base"
                               />
                             </div>
                          </div>
                          <button 
                            onClick={() => {
                              if (audioRef.current) audioRef.current.currentTime = seg.startTime;
                              setIsPlaying(true);
                              audioRef.current?.play();
                            }}
                            className="w-10 h-10 bg-blue-600/10 border border-blue-500/30 rounded-xl flex items-center justify-center text-blue-400 hover:bg-blue-600 hover:text-white transition-all shadow-lg"
                          >
                            <Play size={16} className="translate-x-0.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="pt-8 mt-auto border-t border-white/10">
                    <button 
                      onClick={() => setMode('train')}
                      className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold shadow-xl shadow-blue-600/30 hover:bg-blue-700 active:scale-[0.98] transition-all flex items-center justify-center gap-3"
                    >
                      <Save size={20} /> 完成配置，开始训练
                    </button>
                  </div>
                </div>
              </div>
            </div>
            </motion.div>
          )}

          {mode === 'train' && (
            <motion.div 
               key="train"
               initial={{ opacity: 0, y: 20 }}
               animate={{ opacity: 1, y: 0 }}
               exit={{ opacity: 0, y: -20 }}
               className="max-w-7xl mx-auto space-y-8"
            >
              {/* Top: Global Player */}
              <div className="glass p-8 rounded-[40px] border-white/10 shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-30" />
                
                <div className="flex flex-col gap-6">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="space-y-1">
                      <div className="flex items-center gap-3">
                        <span className="text-[9px] font-black text-blue-500 uppercase tracking-[0.4em]">Integrated Listening System</span>
                        {isSyncing ? (
                          <span className="text-[8px] font-bold text-blue-400/60 animate-pulse bg-blue-500/10 px-2 py-0.5 rounded-full uppercase tracking-widest">Saving...</span>
                        ) : lastSaved && (
                          <span className="text-[8px] font-medium text-slate-500 uppercase tracking-widest bg-white/5 px-2 py-0.5 rounded-full">Synced {lastSaved}</span>
                        )}
                      </div>
                    <div className="flex items-center gap-3">
                        <input 
                          value={material.title}
                          onChange={(e) => setMaterial(p => ({ ...p, title: e.target.value }))}
                          className="text-3xl font-black tracking-tighter text-white leading-tight bg-transparent border-none focus:outline-none focus:ring-0 p-0 flex-1 min-w-0"
                          placeholder="输入听力材料标题..."
                        />
                        {(isAdmin || (user && material.ownerId === user.uid)) && currentMaterialId && (
                           <button 
                             onClick={async () => {
                               if (confirm('确定要【彻底删除】此整个材料库文件及所有配置吗？')) {
                                 try {
                                   await deleteDoc(doc(db, 'materials', currentMaterialId));
                                   setMode('gallery');
                                   setCurrentMaterialId(null);
                                   setMaterial({ title: '未命名听力材料', audioUrl: '', script: '', segments: [] });
                                 } catch (err) {
                                   console.error("Delete failed", err);
                                   alert("删除失败，请检查网络或权限。");
                                 }
                               }
                             }}
                             className="p-2 text-red-500/50 hover:text-red-500 transition-colors bg-red-500/5 rounded-xl border border-red-500/10 shrink-0"
                             title="彻底删除整库"
                           >
                             <Trash2 size={24} />
                           </button>
                        )}
                      </div>
                    </div>



                    <div className="flex items-center gap-6 glass-dark p-4 rounded-3xl border-white/5">
                      <div className="flex flex-col gap-1">
                        <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest leading-none">PLAYBACK SPEED</span>
                        <span className="text-sm font-mono font-bold text-blue-400">{playbackSpeed.toFixed(1)}x</span>
                      </div>
                      <input 
                        type="range"
                        min="0.5"
                        max="2.5"
                        step="0.1"
                        value={playbackSpeed}
                        onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
                        className="w-40 h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-blue-500"
                      />
                    </div>
                  </div>

                  <div className="bg-black/30 rounded-[32px] p-8 border border-white/5 shadow-inner">
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-10 items-center">
                      {/* Left info */}
                      <div className="hidden md:flex flex-col gap-2">
                        <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">CURRENT FOCUS</span>
                        <p className="text-white font-bold truncate">
                          {activeSegmentIndex !== null ? material.segments[activeSegmentIndex].label : "自由浏览中..."}
                        </p>
                      </div>

                      {/* Center Controls */}
                        <div className="flex flex-col items-center gap-6">
                          {!material.audioUrl ? (
                            <div className="flex flex-col items-center gap-4">
                              <p className="text-sm text-yellow-500 font-bold">此文件夹包含配置但未加载音频</p>
                              <label className="px-6 py-3 bg-blue-600 text-white rounded-2xl font-bold cursor-pointer hover:bg-blue-500 transition-all shadow-xl shadow-blue-600/20">
                                <Upload size={18} className="inline mr-2" /> 选择音频文件开始训练
                                <input type="file" accept="audio/*" className="hidden" onChange={handleAudioUpload} />
                              </label>
                            </div>
                          ) : (
                            <div className="flex items-center gap-10">
                              <button onClick={() => skip(-10)} className="w-16 h-16 rounded-full flex items-center justify-center text-slate-400 glass hover:text-white transition-all bg-white/5">
                                <Rewind size={32} />
                              </button>
                              <button 
                                onClick={togglePlay} 
                                className="w-28 h-28 bg-blue-600 rounded-full flex items-center justify-center text-white shadow-[0_0_50px_rgba(37,99,235,0.5)] hover:scale-105 active:scale-95 transition-all"
                              >
                                {isPlaying ? <Pause size={48} /> : <Play size={48} className="translate-x-1.5" />}
                              </button>
                              <button onClick={() => skip(10)} className="w-16 h-16 rounded-full flex items-center justify-center text-slate-400 glass hover:text-white transition-all bg-white/5">
                                <FastForward size={32} />
                              </button>
                            </div>
                          )}

                        <div className="w-full max-w-sm space-y-2">
                          <input 
                             type="range" 
                             min="0" 
                             max={duration} 
                             value={currentTime}
                             onChange={(e) => {
                               if (audioRef.current) audioRef.current.currentTime = parseFloat(e.target.value);
                             }}
                             className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-blue-500"
                           />
                           <div className="flex justify-between text-[10px] font-mono font-bold">
                             <span className="text-blue-500">{formatTime(currentTime)}</span>
                             <span className="text-slate-600">{formatTime(duration)}</span>
                           </div>
                        </div>
                      </div>

                      {/* Right decoration */}
                      <div className="hidden md:flex items-center justify-end gap-1 px-4 h-12">
                        {[...Array(12)].map((_, i) => (
                          <motion.div 
                            key={i}
                            animate={{ height: isPlaying ? [10, 30, 15, 40, 20][i % 5] : 4 }}
                            transition={{ repeat: Infinity, duration: 0.6, delay: i * 0.1 }}
                            className="w-1 bg-blue-500/40 rounded-full"
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom: Splits Display */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                {/* Left-Bottom: Topic List */}
                <div className="lg:col-span-4 space-y-4">
                  <div className="glass p-6 rounded-[32px] border-white/10 space-y-6 min-h-[400px]">
                    <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] flex items-center gap-3">
                      <ListMusic size={16} className="text-blue-500" /> 题目库
                    </h3>
                    <div className="space-y-2 overflow-y-auto max-h-[500px] pr-2 custom-scrollbar">
                      {material.segments.map((seg, idx) => (
                        <button 
                          key={seg.id}
                          onClick={() => {
                            if (audioRef.current) audioRef.current.currentTime = seg.startTime;
                            setIsPlaying(true);
                            audioRef.current?.play();
                          }}
                          className={cn(
                            "w-full px-6 py-6 rounded-3xl flex items-center justify-between border transition-all text-left group",
                            activeSegmentIndex === idx 
                              ? "bg-blue-600/30 border-blue-500 text-white shadow-xl shadow-blue-500/10 ring-4 ring-blue-500/20" 
                              : "bg-white/5 border-white/10 text-slate-400 hover:border-white/30"
                          )}
                        >
                          <div className="flex items-center gap-4">
                            <span className={cn(
                              "w-10 h-10 rounded-xl flex items-center justify-center text-lg font-black",
                              activeSegmentIndex === idx ? "bg-blue-500 text-white" : "bg-white/10 text-slate-500 font-mono"
                            )}>{idx + 1}</span>
                            <span className="text-xl font-bold">{seg.label}</span>
                          </div>
                          <span className="text-sm font-mono opacity-50 bg-black/20 px-2 py-1 rounded-lg">{formatTime(seg.startTime)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Right-Bottom: Focused Transcript */}
                <div className="lg:col-span-8">
                  <div className="glass p-8 rounded-[40px] border-white/10 flex flex-col min-h-[400px]">
                    <div className="flex items-center justify-between mb-8 pb-4 border-b border-white/5">
                      <div className="flex items-center gap-3">
                        <BookOpen size={20} className="text-blue-400" />
                        <h3 className="font-bold text-white">当前题目内容</h3>
                      </div>
                      
                      <div className="flex items-center gap-3">
                        <button 
                          onClick={() => setShowSubtitles(!showSubtitles)}
                          className={cn(
                            "px-4 py-2 text-[10px] font-bold rounded-xl transition-all border",
                            showSubtitles ? "bg-blue-600 border-blue-500 text-white" : "btn-glass border-white/5 text-slate-500"
                          )}
                        >
                          显示字幕：{showSubtitles ? "开" : "关"}
                        </button>
                      </div>
                    </div>
                    
                    <div ref={transcriptRef} className="flex-grow overflow-y-auto custom-scrollbar">
                       {renderTranscript(true)}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {material.audioUrl && (
        <audio 
          ref={audioRef}
          src={material.audioUrl}
          crossOrigin="anonymous"
          onError={() => {
            // Do not log the full event object to avoid circular structure issues
            console.error("Audio Error for URL:", material.audioUrl);
            if (material.audioUrl?.startsWith('blob:')) {
              alert("音频预览已过期或文件未找到，请重新上传。");
            }
          }}
        />
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #E5E5E5;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #D4D4D4;
        }
      `}</style>
    </div>
  );
}
