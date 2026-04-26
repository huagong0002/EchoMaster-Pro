import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Play, Pause, RotateCcw, Settings2, BookOpen, Clock, Plus, Trash2, 
  Download, Upload, FastForward, Rewind, CheckCircle2, ListMusic, 
  ArrowRight, Save, LogIn, LogOut, FolderOpen, Home as HomeIcon, 
  User as UserIcon, ShieldCheck, Edit3, ArrowLeft 
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// --- 类型定义 ---
interface AudioSegment {
  id: string;
  label: string;
  startTime: number;
  endTime: number;
  subtitle?: string;
}

interface ListeningMaterial {
  id?: string;
  title: string;
  audioUrl: string;
  script: string;
  segments: AudioSegment[];
  ownerId?: string;
}

interface LocalUser {
  id: string;
  username: string;
  displayName: string;
  role: 'user' | 'admin';
}

// --- 工具函数 ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- API 助手 (适配 Vercel Serverless) ---
const api = {
  get: async (url: string) => {
    const token = localStorage.getItem('echomaster_token');
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`请求失败: ${res.status}`);
    return res.json();
  },
  post: async (url: string, data: any) => {
    const token = localStorage.getItem('echomaster_token');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || `操作失败: ${res.status}`);
    }
    return res.json();
  },
  delete: async (url: string) => {
    const token = localStorage.getItem('echomaster_token');
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`删除失败: ${res.status}`);
    return res.json();
  }
};

export default function App() {
  // --- 核心状态 ---
  const [mode, setMode] = useState<'setup' | 'edit' | 'train' | 'gallery'>('setup');
  const [user, setUser] = useState<LocalUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [materials, setMaterials] = useState<(ListeningMaterial & { id: string })[]>([]);
  const [usersMap, setUsersMap] = useState<Record<string, string>>({});
  
  // --- 认证状态 ---
  const [showAuthOverlay, setShowAuthOverlay] = useState(false);
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // --- 材料编辑状态 ---
  const [material, setMaterial] = useState<ListeningMaterial>({
    title: '未命名听力材料',
    audioUrl: '',
    script: '',
    segments: [],
  });
  const [currentMaterialId, setCurrentMaterialId] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  // --- 播放器状态 ---
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number | null>(null);
  const [showSubtitles, setShowSubtitles] = useState(true);

  // --- 管理员逻辑 ---
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');

  // 1. 初始化检查
  useEffect(() => {
    const savedToken = localStorage.getItem('echomaster_token');
    const savedUser = localStorage.getItem('echomaster_user');
    if (savedToken && savedUser) {
      try {
        const u = JSON.parse(savedUser);
        setToken(savedToken);
        setUser(u);
        setIsAdmin(u.role === 'admin');
        fetchInitialData();
      } catch (e) {
        logout();
      }
    }
  }, []);

  const fetchInitialData = async () => {
    try {
      const [mats, uMap] = await Promise.all([
        api.get('/api/materials'),
        api.get('/api/users/map')
      ]);
      setMaterials(mats);
      setUsersMap(uMap);
    } catch (err) {
      console.error("数据加载失败", err);
    }
  };

  // 2. 登录逻辑 (对接你的 Flask 后端)
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setIsLoggingIn(true);
    
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: authUsername.trim(), password: authPassword })
      });
      
      if (res.status === 404) throw new Error('接口未找到 (404)，请检查 vercel.json 配置');
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || '登录失败');

      localStorage.setItem('echomaster_token', data.token);
      localStorage.setItem('echomaster_user', JSON.stringify(data.user));
      
      setToken(data.token);
      setUser(data.user);
      setIsAdmin(data.user.role === 'admin');
      setShowAuthOverlay(false);
      fetchInitialData();
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const logout = () => {
    localStorage.clear();
    setUser(null);
    setToken(null);
    setIsAdmin(false);
    setMode('setup');
  };

  // 3. 听力分段逻辑
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

  const addSegment = () => {
    const newSeg: AudioSegment = {
      id: Math.random().toString(36).substr(2, 9),
      label: `题目 ${material.segments.length + 1}`,
      startTime: currentTime,
      endTime: Math.min(currentTime + 5, duration),
      subtitle: ''
    };
    setMaterial(prev => ({ ...prev, segments: [...prev.segments, newSeg] }));
  };

  const saveToCloud = async () => {
    if (!user) { setShowAuthOverlay(true); return; }
    setIsSyncing(true);
    try {
      const id = currentMaterialId || Math.random().toString(36).substr(2, 9);
      await api.post('/api/materials', { ...material, id });
      setCurrentMaterialId(id);
      setLastSaved(new Date().toLocaleTimeString());
      fetchInitialData();
    } catch (err) {
      alert("保存失败，请检查网络");
    } finally {
      setIsSyncing(false);
    }
  };

  // --- 渲染部分 (精简版) ---
  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-200 selection:bg-blue-500/30">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-50 bg-[#0f172a]/80 backdrop-blur-md border-b border-white/5 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold">E</div>
            <div>
              <h1 className="text-lg font-bold leading-none">EchoMaster Pro</h1>
              <p className="text-[10px] text-blue-400 tracking-widest mt-1 uppercase">Local Database Mode</p>
            </div>
          </div>
          
          <nav className="flex items-center gap-4">
            <button onClick={() => setMode('gallery')} className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg hover:bg-white/5">
              <FolderOpen size={16} /> 材料库
            </button>
            {user ? (
              <button onClick={logout} className="flex items-center gap-2 text-sm text-red-400 px-4 py-2 rounded-lg hover:bg-red-400/10">
                <LogOut size={16} /> 登出
              </button>
            ) : (
              <button onClick={() => setShowAuthOverlay(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold">
                登录
              </button>
            )}
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6">
        <AnimatePresence mode="wait">
          {/* 登录弹窗 */}
          {showAuthOverlay && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-[#1e293b] border border-white/10 p-8 rounded-3xl w-full max-w-md">
                <h2 className="text-2xl font-bold mb-6 text-center">校园网账号登录</h2>
                <form onSubmit={handleAuth} className="space-y-4">
                  <input 
                    type="text" 
                    placeholder="用户名" 
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-blue-500"
                    value={authUsername}
                    onChange={e => setAuthUsername(e.target.value)}
                  />
                  <input 
                    type="password" 
                    placeholder="密码" 
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-blue-500"
                    value={authPassword}
                    onChange={e => setAuthPassword(e.target.value)}
                  />
                  {authError && <p className="text-red-400 text-xs text-center">{authError}</p>}
                  <button type="submit" disabled={isLoggingIn} className="w-full bg-blue-600 py-3 rounded-xl font-bold hover:bg-blue-500 disabled:opacity-50">
                    {isLoggingIn ? '正在连接后端...' : '立即登录'}
                  </button>
                  <button type="button" onClick={() => setShowAuthOverlay(false)} className="w-full text-slate-500 text-sm">取消</button>
                </form>
              </div>
            </motion.div>
          )}

          {/* 初始界面 / 设置模式 */}
          {mode === 'setup' && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-xl mx-auto space-y-8 py-12 text-center">
              <div className="space-y-4">
                <h2 className="text-4xl font-black text-white">欢迎使用 EchoMaster</h2>
                <p className="text-slate-400">高校听力个性化训练系统 (本地数据库版)</p>
              </div>
              <div className="grid gap-4">
                <button 
                  onClick={() => setMode('gallery')}
                  className="bg-blue-600 hover:bg-blue-500 text-white py-6 rounded-3xl font-bold text-xl shadow-xl shadow-blue-600/20 transition-all flex items-center justify-center gap-4"
                >
                  <FolderOpen size={28} /> 进入材料库
                </button>
                {isAdmin && (
                  <button 
                    onClick={() => {
                       const title = prompt('输入材料标题:');
                       if (title) {
                         setMaterial({ title, audioUrl: '', script: '', segments: [] });
                         setMode('edit');
                       }
                    }}
                    className="bg-white/5 hover:bg-white/10 border border-white/10 text-white py-4 rounded-3xl font-bold transition-all"
                  >
                    + 创建新材料 (管理员)
                  </button>
                )}
              </div>
            </motion.div>
          )}

          {/* 材料库界面 */}
          {mode === 'gallery' && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold">听力材料库</h2>
                  <p className="text-sm text-slate-400">已加载 {materials.length} 个材料</p>
                </div>
                <button onClick={() => fetchInitialData()} className="p-2 text-slate-400 hover:text-white">
                  <RotateCcw size={20} />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {materials.map(m => (
                  <div key={m.id} className="bg-[#1e293b] border border-white/10 p-6 rounded-[32px] hover:border-blue-500/40 transition-all group">
                    <h3 className="text-lg font-bold mb-2 group-hover:text-blue-400">{m.title}</h3>
                    <div className="flex items-center gap-3 text-xs text-slate-500 mb-6">
                      <Clock size={14}/> {m.segments.length} 个分段
                      <span>•</span>
                      <span>上传者: {usersMap[m.ownerId || ''] || '未知'}</span>
                    </div>
                    <div className="flex gap-2">
                       <button 
                        onClick={() => {
                          setMaterial(m);
                          setCurrentMaterialId(m.id!);
                          setMode('train');
                        }}
                        className="flex-1 bg-blue-600/10 text-blue-400 py-3 rounded-xl font-bold hover:bg-blue-600 hover:text-white transition-all flex items-center justify-center gap-2"
                      >
                        <Play size={16}/> 开始练习
                      </button>
                      {(isAdmin || (user && m.ownerId === user.id)) && (
                        <button 
                          onClick={() => {
                            setMaterial(m);
                            setCurrentMaterialId(m.id!);
                            setMode('edit');
                          }}
                          className="px-4 bg-white/5 text-slate-400 py-3 rounded-xl hover:bg-white/10"
                        >
                          <Settings2 size={16}/>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* 编辑模式 (简易版) */}
          {mode === 'edit' && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
               <div className="bg-[#1e293b] border border-white/10 p-8 rounded-[40px] space-y-6">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold">编辑材料: {material.title}</h2>
                    <button onClick={() => setMode('gallery')} className="text-slate-500 hover:text-white">取消</button>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-xs text-slate-500 uppercase font-bold tracking-widest">音频直链 (URL)</label>
                      <input 
                        type="text"
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-blue-500"
                        value={material.audioUrl}
                        onChange={e => setMaterial({...material, audioUrl: e.target.value})}
                        placeholder="https://example.com/audio.mp3"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-slate-500 uppercase font-bold tracking-widest">听力原文</label>
                      <textarea 
                        className="w-full h-32 bg-white/5 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-blue-500"
                        value={material.script}
                        onChange={e => setMaterial({...material, script: e.target.value})}
                        placeholder="粘贴听力原文字幕..."
                      />
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <button 
                      onClick={saveToCloud}
                      disabled={isSyncing}
                      className="flex-1 bg-blue-600 py-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-blue-500"
                    >
                      <Save size={20}/> {isSyncing ? '同步中...' : '提交保存'}
                    </button>
                    <button 
                      onClick={addSegment}
                      className="px-6 bg-white/5 border border-white/10 rounded-2xl font-bold hover:bg-white/10 flex items-center gap-2"
                    >
                      <Plus size={20}/> 新增分段
                    </button>
                  </div>
               </div>

               <div className="grid gap-4">
                 {material.segments.map((seg, idx) => (
                   <div key={seg.id} className="bg-[#1e293b] border border-white/10 p-6 rounded-3xl grid grid-cols-1 md:grid-cols-4 gap-4">
                     <input 
                        value={seg.label}
                        onChange={e => {
                          const newSegs = [...material.segments];
                          newSegs[idx].label = e.target.value;
                          setMaterial({...material, segments: newSegs});
                        }}
                        className="bg-transparent border-b border-white/10 outline-none font-bold"
                     />
                     <div className="flex gap-2">
                        <input type="number" value={seg.startTime} step="0.1" onChange={e => {
                          const newSegs = [...material.segments];
                          newSegs[idx].startTime = parseFloat(e.target.value);
                          setMaterial({...material, segments: newSegs});
                        }} className="w-full bg-white/5 p-2 rounded-lg text-xs" />
                        <input type="number" value={seg.endTime} step="0.1" onChange={e => {
                          const newSegs = [...material.segments];
                          newSegs[idx].endTime = parseFloat(e.target.value);
                          setMaterial({...material, segments: newSegs});
                        }} className="w-full bg-white/5 p-2 rounded-lg text-xs" />
                     </div>
                     <textarea 
                        value={seg.subtitle}
                        onChange={e => {
                          const newSegs = [...material.segments];
                          newSegs[idx].subtitle = e.target.value;
                          setMaterial({...material, segments: newSegs});
                        }}
                        className="md:col-span-2 bg-white/5 p-3 rounded-xl text-sm outline-none focus:border-blue-500/40 border border-transparent"
                        placeholder="该分段显示的字幕..."
                     />
                   </div>
                 ))}
               </div>
            </motion.div>
          )}

          {/* 训练模式界面 */}
          {mode === 'train' && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
              {/* 播放器核心 */}
              <div className="bg-[#1e293b] border border-white/10 p-8 rounded-[40px] text-center">
                <h2 className="text-2xl font-black mb-6">{material.title}</h2>
                <div className="flex items-center justify-center gap-8 mb-8">
                  <button onClick={() => skip(-10)} className="p-4 text-slate-500 hover:text-white"><Rewind size={32}/></button>
                  <button onClick={togglePlay} className="w-24 h-24 bg-blue-600 rounded-full flex items-center justify-center text-white shadow-xl">
                    {isPlaying ? <Pause size={48}/> : <Play size={48} className="translate-x-1"/>}
                  </button>
                  <button onClick={() => skip(10)} className="p-4 text-slate-500 hover:text-white"><FastForward size={32}/></button>
                </div>
                <div className="max-w-md mx-auto">
                   <p className="text-blue-400 font-mono text-xl mb-2">{formatTime(currentTime)} / {formatTime(duration)}</p>
                   <input 
                    type="range" min="0" max={duration} value={currentTime} 
                    onChange={e => audioRef.current && (audioRef.current.currentTime = parseFloat(e.target.value))}
                    className="w-full h-2 bg-white/10 rounded-full accent-blue-500"
                   />
                </div>
              </div>

              {/* 题目列表 */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-[#1e293b] border border-white/10 p-6 rounded-3xl h-[400px] overflow-y-auto">
                  <h3 className="text-sm font-bold text-slate-500 uppercase mb-4 tracking-widest">题目分段</h3>
                  {material.segments.map((seg, idx) => (
                    <button 
                      key={seg.id} 
                      onClick={() => audioRef.current && (audioRef.current.currentTime = seg.startTime)}
                      className={cn(
                        "w-full text-left p-4 mb-2 rounded-xl border transition-all",
                        activeSegmentIndex === idx ? "bg-blue-600/20 border-blue-500" : "bg-white/5 border-transparent"
                      )}
                    >
                      <div className="font-bold">{seg.label}</div>
                      <div className="text-[10px] opacity-50 font-mono">{formatTime(seg.startTime)} - {formatTime(seg.endTime)}</div>
                    </button>
                  ))}
                </div>
                
                <div className="md:col-span-2 bg-[#1e293b] border border-white/10 p-8 rounded-3xl min-h-[400px]">
                   <div className="flex items-center justify-between mb-6">
                     <h3 className="font-bold flex items-center gap-2"><BookOpen size={18}/> 听力原文/字幕</h3>
                     <button onClick={() => setShowSubtitles(!showSubtitles)} className="text-xs text-blue-400">
                       {showSubtitles ? '隐藏字幕' : '显示字幕'}
                     </button>
                   </div>
                   <div className="text-2xl font-bold leading-relaxed text-slate-300">
                     {showSubtitles ? (
                       activeSegmentIndex !== null ? material.segments[activeSegmentIndex].subtitle : "点击左侧题目开始练习"
                     ) : "🔒 字幕已隐藏"}
                   </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* 隐藏的音频组件 */}
      <audio 
        ref={audioRef} 
        src={material.audioUrl} 
        onTimeUpdate={() => {
          if (!audioRef.current) return;
          const time = audioRef.current.currentTime;
          setCurrentTime(time);
          const idx = material.segments.findIndex(s => time >= s.startTime && time <= s.endTime);
          setActiveSegmentIndex(idx === -1 ? null : idx);
        }}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      />
    </div>
  );
}

// --- 辅助函数 ---
function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}