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
  LogOut,
  User as UserIcon,
  HelpCircle,
  FileText,
  Search,
  Library as LibraryIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { AudioSegment, ListeningMaterial, User } from './types';
import { api } from './services/api';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const INSTRUCTIONS_SCRIPT = `
## 🚀 软件使用说明 (EchoMaster Pro)

本软件专为英语教师和学生设计，旨在提供沉浸式的听力训练和材料制作体验。

### 1. 准备阶段 (设置)
- **上传音频**: 支持 MP3/WAV 格式。由于网络环境优化，音频仅在本地处理，速度极快。
- **输入脚本**: 在文字区域粘贴听力文稿。
- **智能标识**: 在对话或题目开始处加入时间戳，如 \`[00:15]\`，系统将自动识别并切分题目。

### 2. 素材制作 (分段)
- **快速切割**: 播放音频并在题目切换点点击“快速切割”，可实时捕捉时间点。
- **内容微调**: 为每一段添加详细的原文或重点词汇。
- **同步保存**: 点击保存图标，您的作品将同步至云端材料库。

### 3. 课堂/训练 (练习)
- **倍速调节**: 支持 0.5x 到 2.5x 的精细调节，适应不同学段。
- **循环播放**: 可通过题目列表快速跳转，反复磨耳朵。
- **交互跟随**: 播放时，对应的脚本内容会自动高亮显示。

### 4. 共享与管理 (库)
- **全员共享**: 所有用户上传的材料在“共享材料库”中均可见。
- **多端同步**: 账号登录后，您在办公室制作的材料可直接在希沃白板上打开。
- **账号管理**: 由管理员分配账号，确保教学环境的纯净与安全。
`;

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoadingUser, setIsLoadingUser] = useState(true);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');

  const [mode, setMode] = useState<'setup' | 'edit' | 'train' | 'library' | 'users'>('setup');
  const [material, setMaterial] = useState<ListeningMaterial>({
    title: '未命名听力材料',
    audioUrl: '',
    script: INSTRUCTIONS_SCRIPT,
    segments: [],
  });

  const [library, setLibrary] = useState<ListeningMaterial[]>([]);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  // Auth Hook
  useEffect(() => {
    api.getMe().then(u => {
      setUser(u);
      setIsLoadingUser(false);
      if (u) loadLibrary();
    });
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    try {
      const u = await api.login(loginForm.username, loginForm.password);
      setUser(u);
      loadLibrary();
    } catch (err: any) {
      setLoginError(err.message);
    }
  };

  const handleLogout = async () => {
    await api.logout();
    setUser(null);
    setMode('setup');
  };

  const loadLibrary = async () => {
    try {
      const materials = await api.getMaterials();
      setLibrary(materials);
    } catch (err) {
      console.error(err);
    }
  };

  const manualSave = async () => {
    if (!user) return;
    try {
      const { id } = await api.saveMaterial(material);
      setMaterial(prev => ({ ...prev, id }));
      setLastSaved(new Date().toLocaleTimeString());
      loadLibrary();
    } catch (err) {
      alert("保存失败，请重试");
    }
  };

  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number | null>(null);
  const [showSubtitles, setShowSubtitles] = useState(true);
  const [syncScroll, setSyncScroll] = useState(true);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const [users, setUsers] = useState<User[]>([]);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'user' as any });

  const loadUsers = async () => {
    try {
      const u = await api.getUsers();
      setUsers(u);
    } catch (err) {}
  };

  useEffect(() => {
    if (mode === 'users') loadUsers();
  }, [mode]);

  // File Upload Handlers
  const handleAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setMaterial(prev => ({ ...prev, audioUrl: url }));
      if (mode === 'setup') setMode('edit');
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

  const clearAllSegments = () => {
    setMaterial(prev => ({ ...prev, segments: [] }));
    setActiveSegmentIndex(null);
    setCurrentTime(0);
    if (audioRef.current) audioRef.current.currentTime = 0;
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      if (mode === 'train') {
        const currentIdx = material.segments.findIndex(
          seg => audio.currentTime >= seg.startTime && audio.currentTime < seg.endTime
        );
        if (currentIdx !== activeSegmentIndex) {
          setActiveSegmentIndex(currentIdx === -1 ? null : currentIdx);
        }
      }
    };

    const handleLoadedMetadata = () => setDuration(audio.duration);

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('play', () => setIsPlaying(true));
    audio.addEventListener('pause', () => setIsPlaying(false));

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [material.segments, mode, activeSegmentIndex]);

  useEffect(() => {
    if (mode === 'train' && syncScroll && activeSegmentIndex !== null && transcriptRef.current) {
      const activeElement = transcriptRef.current.querySelector(`[data-segment-index="${activeSegmentIndex}"]`);
      if (activeElement) {
        activeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [activeSegmentIndex, mode, syncScroll]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackSpeed;
  }, [playbackSpeed]);

  const formatTime = (time: number) => `${Math.floor(time)}s`;

  const renderTranscript = (onlyActive: boolean = false) => {
    let items = material.segments.map((seg, idx) => ({
      index: idx,
      text: seg.subtitle || '',
      startTime: seg.startTime,
      endTime: seg.endTime
    }));

    if (onlyActive && activeSegmentIndex !== null) items = [items[activeSegmentIndex]];

    if (items.length === 0 || (onlyActive && activeSegmentIndex === null)) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-slate-400 italic py-10 opacity-60">
          <BookOpen size={64} className="mb-4 text-blue-500" />
          <p className="text-xl">{onlyActive ? "点击播放题目查看内容" : "暂无分段内容"}</p>
        </div>
      );
    }
    
    return (
      <div className={cn("flex flex-col w-full", onlyActive ? "gap-6" : "gap-16 py-10")}>
        {items.map((item) => {
          const isActive = onlyActive ? true : item.index === activeSegmentIndex;
          const lines = item.text.split('\n');
          const segmentDuration = item.endTime - item.startTime;
          const totalWords = item.text.split(/\s+/).filter(Boolean).length;
          let currentWordGlobalIdx = 0;

          return (
            <motion.div 
              key={item.index}
              data-segment-index={item.index}
              initial={false}
              animate={{ opacity: showSubtitles ? (isActive ? 1 : 0.3) : 0, scale: isActive ? 1.02 : 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 25 }}
              className={cn(
                "w-full text-left transition-all duration-500 whitespace-pre-wrap",
                isActive ? "text-white" : "text-slate-500"
              )}
            >
              {lines.map((line, lIdx) => {
                const words = line.split(/(\s+)/);
                return (
                  <div key={lIdx} className="flex flex-wrap">
                    {words.map((word, wIdx) => {
                      if (word.trim() === '') return <span key={wIdx}>{word}</span>;
                      const wordIdxInLine = currentWordGlobalIdx++;
                      let isWordActive = false;
                      if (isActive && segmentDuration > 0 && totalWords > 0) {
                        const elapsed = currentTime - item.startTime;
                        const wordProgress = (elapsed / segmentDuration) * totalWords;
                        isWordActive = wordIdxInLine <= wordProgress;
                      }
                      return (
                        <motion.span
                          key={wIdx}
                          initial={false}
                          animate={{ color: isActive && isWordActive ? '#60a5fa' : 'inherit' }}
                          className={cn("text-2xl md:text-3xl font-medium inline-block", isActive && isWordActive ? "font-bold" : "")}
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

  if (isLoadingUser) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white font-bold text-2xl">正在加载...</div>;
  }

  if (!user) {
    return (
      <div className="min-h-screen app-bg flex items-center justify-center p-6">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="glass p-12 rounded-[40px] max-w-md w-full shadow-2xl border-white/20">
          <div className="text-center mb-8">
            <div className="w-20 h-20 bg-blue-600 rounded-[28px] flex items-center justify-center text-white font-black text-3xl shadow-xl shadow-blue-600/30 mx-auto mb-6">E</div>
            <h1 className="text-3xl font-black text-white tracking-tighter">EchoMaster Pro</h1>
            <p className="text-slate-400 font-medium mt-2">请登录教学账号</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">用户名</label>
              <input 
                type="text" 
                value={loginForm.username} 
                onChange={e => setLoginForm(p => ({...p, username: e.target.value}))}
                className="w-full h-14 bg-white/5 border border-white/10 rounded-2xl px-5 text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 transition-all font-medium"
                placeholder="Account"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">密码</label>
              <input 
                type="password" 
                value={loginForm.password} 
                onChange={e => setLoginForm(p => ({...p, password: e.target.value}))}
                className="w-full h-14 bg-white/5 border border-white/10 rounded-2xl px-5 text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 transition-all font-medium"
                placeholder="••••••••"
              />
            </div>
            {loginError && <p className="text-red-500 text-sm font-medium ml-1">{loginError}</p>}
            <button className="w-full h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold text-lg shadow-lg shadow-blue-800/20 active:scale-[0.98] transition-all pt-1">登 录</button>
          </form>
          <div className="mt-8 pt-8 border-t border-white/10 text-center">
            <p className="text-slate-500 text-xs">如有账号问题，请联系系统管理员</p>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen font-sans selection:bg-blue-500/30 selection:text-white pb-20">
      <audio ref={audioRef} src={material.audioUrl} />
      
      {/* Header */}
      <header className="sticky top-0 z-50 glass border-b border-white/10">
        <div className="max-w-[1600px] mx-auto px-8 h-24 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="w-14 h-14 bg-blue-600 rounded-[20px] flex items-center justify-center text-white font-black text-2xl shadow-lg shadow-blue-600/30">E</div>
            <div>
              <h1 className="text-2xl font-black tracking-tighter text-white leading-none">EchoMaster Pro</h1>
              <div className="flex items-center gap-3 mt-2">
                <span className="text-[10px] text-blue-400 font-bold uppercase tracking-[0.3em]">Listening Lab</span>
                <div className="w-1 h-1 bg-slate-700 rounded-full" />
                <div className="flex items-center gap-1.5 text-slate-400">
                  <UserIcon size={12} className="text-blue-500" />
                  <span className="text-xs font-bold">{user.username} {user.role === 'admin' ? '(管理员)' : ''}</span>
                </div>
              </div>
            </div>
          </div>

          <nav className="flex items-center gap-4">
            {user.role === 'admin' && (
              <button 
                onClick={() => setMode('users')}
                className={cn(
                  "px-8 h-14 text-base font-bold transition-all rounded-2xl flex items-center gap-3",
                  mode === 'users' ? "bg-blue-600 text-white shadow-xl shadow-blue-600/20" : "btn-glass text-slate-300"
                )}
              >
                <UserIcon size={20} /> 账号管理
              </button>
            )}
            <button 
              onClick={() => { loadLibrary(); setMode('library'); }}
              className={cn(
                "px-8 h-14 text-base font-bold transition-all rounded-2xl flex items-center gap-3",
                mode === 'library' ? "bg-blue-600 text-white shadow-xl shadow-blue-600/20" : "btn-glass text-slate-300"
              )}
            >
              <LibraryIcon size={20} /> 共享库
            </button>
            <div className="w-[1px] h-10 bg-white/10 mx-2" />
            <button 
              onClick={() => setMode('setup')}
              className={cn(
                "px-8 h-14 text-base font-bold transition-all rounded-2xl flex items-center gap-3",
                mode === 'setup' ? "bg-blue-600 text-white shadow-xl shadow-blue-600/20" : "btn-glass text-slate-300"
              )}
            >
              <FileText size={20} /> 使用说明
            </button>
            <button 
              onClick={() => setMode('edit')}
              className={cn(
                "px-8 h-14 text-base font-bold transition-all rounded-2xl flex items-center gap-3",
                mode === 'edit' ? "bg-blue-600 text-white shadow-xl shadow-blue-600/20" : "btn-glass text-slate-300"
              )}
            >
              <Settings2 size={20} /> 工具台
            </button>
            <button 
              onClick={() => setMode('train')}
              className={cn(
                "px-8 h-14 text-base font-bold transition-all rounded-2xl flex items-center gap-3",
                mode === 'train' ? "bg-blue-600 text-white shadow-xl shadow-blue-600/20" : "btn-glass text-slate-300"
              )}
            >
              <Play size={20} /> 教学模式
            </button>
            <button 
              onClick={handleLogout}
              className="p-4 btn-glass rounded-2xl text-red-400 hover:text-red-300 transition-all ml-4"
              title="退出登录"
            >
              <LogOut size={24} />
            </button>
          </nav>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-8 py-12">
        <AnimatePresence mode="wait">
          {mode === 'users' && (
            <motion.div key="users" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-10">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-4xl font-black text-white tracking-tight">账号管理中心</h2>
                  <p className="text-slate-400 mt-2 text-lg">仅管理员可见，您可以手动添加或移除教职工账号。</p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
                {/* Create User Form */}
                <div className="lg:col-span-4 glass p-10 rounded-[48px] border-white/10 shadow-2xl h-fit">
                   <h3 className="text-2xl font-bold text-white mb-8">添加新成员</h3>
                   <div className="space-y-6">
                      <div className="space-y-2">
                         <label className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">用户名</label>
                         <input 
                           value={newUser.username}
                           onChange={e => setNewUser(p => ({...p, username: e.target.value}))}
                           className="w-full h-16 bg-white/5 border border-white/10 rounded-2xl px-6 text-white text-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                           placeholder="输入工号或姓名"
                         />
                      </div>
                      <div className="space-y-2">
                         <label className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">初始密码</label>
                         <input 
                           type="password"
                           value={newUser.password}
                           onChange={e => setNewUser(p => ({...p, password: e.target.value}))}
                           className="w-full h-16 bg-white/5 border border-white/10 rounded-2xl px-6 text-white text-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                           placeholder="••••••••"
                         />
                      </div>
                      <div className="space-y-2">
                         <label className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">角色权限</label>
                         <select 
                           value={newUser.role}
                           onChange={e => setNewUser(p => ({...p, role: e.target.value as any}))}
                           className="w-full h-16 bg-slate-900 border border-white/10 rounded-2xl px-6 text-white text-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                         >
                            <option value="user">普通教师</option>
                            <option value="admin">管理员</option>
                         </select>
                      </div>
                      <button 
                         onClick={async () => {
                           if (!newUser.username || !newUser.password) return alert('请填写完整信息');
                           try {
                             await api.createUser(newUser);
                             setNewUser({ username: '', password: '', role: 'user' });
                             loadUsers();
                             alert('创建成功');
                           } catch (err: any) {
                             alert(err.message);
                           }
                         }}
                         className="w-full h-16 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold text-xl shadow-xl shadow-blue-600/20 active:scale-95 transition-all mt-4"
                      >
                         确 认 添 加
                      </button>
                   </div>
                </div>

                {/* Users List */}
                <div className="lg:col-span-8 glass p-10 rounded-[48px] border-white/10 shadow-2xl">
                   <h3 className="text-2xl font-bold text-white mb-8">成员列表 ({users.length})</h3>
                   <div className="space-y-4">
                      {users.map(u => (
                        <div key={u.id} className="p-6 bg-white/5 border border-white/5 rounded-3xl flex items-center justify-between hover:border-white/10 transition-all">
                           <div className="flex items-center gap-6">
                              <div className="w-14 h-14 bg-blue-600/10 rounded-2xl flex items-center justify-center text-blue-500">
                                 <UserIcon size={28} />
                              </div>
                              <div>
                                 <h4 className="text-xl font-bold text-white">{u.username}</h4>
                                 <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">{u.role === 'admin' ? '系统管理员' : '学科教师'}</span>
                              </div>
                           </div>
                           <div className="flex items-center gap-4">
                              {u.username !== 'admin' && (
                                <button 
                                  onClick={async () => {
                                    if (confirm('确定移除该账户吗？相关材料仍将保留。')) {
                                      await api.deleteUser(u.id);
                                      loadUsers();
                                    }
                                  }}
                                  className="p-4 bg-red-500/10 text-red-500 rounded-2xl hover:bg-red-500 hover:text-white transition-all"
                                >
                                  <Trash2 size={24} />
                                </button>
                              )}
                           </div>
                        </div>
                      ))}
                   </div>
                </div>
              </div>
            </motion.div>
          )}

          {mode === 'library' && (
            <motion.div key="library" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-10">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-4xl font-black text-white tracking-tight">共享材料库</h2>
                  <p className="text-slate-400 mt-2 text-lg">点击下方材料卡片进行浏览或二次编辑。</p>
                </div>
                <button onClick={() => setMode('setup')} className="h-16 px-10 bg-blue-600 hover:bg-blue-700 text-white rounded-[20px] font-bold text-lg flex items-center gap-3 transition-all shadow-xl shadow-blue-600/20">
                  <Plus size={24} /> 创建新材料
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
                {library.length === 0 && (
                  <div className="col-span-full py-20 text-center glass rounded-[40px]">
                    <Search size={64} className="mx-auto mb-6 text-slate-700" />
                    <p className="text-slate-500 text-xl font-medium">库中暂无材料，开始创建第一篇吧！</p>
                  </div>
                )}
                {library.map((item) => (
                  <motion.div 
                    key={item.id} 
                    whileHover={{ scale: 1.02 }} 
                    className="glass p-8 rounded-[40px] border-white/10 flex flex-col gap-6 group relative overflow-hidden"
                  >
                    <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-all">
                      { (user.role === 'admin' || user.id === item.authorId) && (
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            if(confirm('确定删除吗？')) {
                              api.deleteMaterial(item.id!).then(() => loadLibrary());
                            }
                          }}
                          className="p-3 bg-red-500/20 text-red-500 rounded-xl hover:bg-red-500 hover:text-white transition-all shadow-lg"
                        >
                          <Trash2 size={18} />
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="w-16 h-16 bg-blue-600/10 rounded-2xl flex items-center justify-center text-blue-500">
                        <FileText size={32} />
                      </div>
                      <div className="flex-grow min-w-0">
                        <h3 className="text-2xl font-bold text-white truncate">{item.title}</h3>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{item.authorName}</span>
                          <div className="w-1 h-1 bg-slate-700 rounded-full" />
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{new Date(item.createdAt!).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                       <div className="p-4 bg-white/5 rounded-2xl flex flex-col gap-1">
                         <span className="text-[8px] font-black text-slate-600 uppercase tracking-widest">题目总数</span>
                         <span className="text-xl font-bold text-white tracking-tighter">{item.segments.length} 题</span>
                       </div>
                       <div className="p-4 bg-white/5 rounded-2xl flex flex-col gap-1">
                         <span className="text-[8px] font-black text-slate-600 uppercase tracking-widest">时长概览</span>
                         <span className="text-xl font-bold text-white tracking-tighter">{formatTime(item.segments[item.segments.length-1]?.endTime || 0)}</span>
                       </div>
                    </div>
                    <button 
                      onClick={() => {
                        setMaterial(item);
                        setMode('train');
                      }}
                      className="w-full h-16 bg-white/10 hover:bg-blue-600 text-white rounded-[20px] font-bold text-lg transition-all flex items-center justify-center gap-3"
                    >
                      开始训练 <ArrowRight size={20} />
                    </button>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {mode === 'setup' && (
            <motion.div key="setup" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="max-w-[1200px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
               {/* Instructions */}
               <div className="glass p-10 rounded-[48px] border-white/10 shadow-2xl relative overflow-hidden h-full">
                  <div className="absolute -top-20 -right-20 w-64 h-64 bg-blue-600/10 blur-[100px] rounded-full" />
                  <div className="relative prose prose-invert prose-slate max-w-none prose-h2:text-4xl prose-h2:font-black prose-h2:tracking-tighter prose-h3:text-2xl prose-h3:font-bold prose-p:text-lg prose-p:text-slate-400 prose-li:text-slate-400 prose-li:text-lg">
                    <Markdown>{INSTRUCTIONS_SCRIPT}</Markdown>
                  </div>
               </div>

               {/* Interaction Card */}
               <div className="glass p-10 rounded-[48px] border-white/10 shadow-2xl flex flex-col gap-10">
                  <div>
                    <h2 className="text-4xl font-black text-white tracking-tight">导入新素材</h2>
                    <p className="text-slate-400 mt-2 text-lg">在此上传音频并完成基础配置。</p>
                  </div>

                  <div className="space-y-8">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.3em] mb-4 ml-1">音频文件 (MP3/WAV)</label>
                      <div className="relative group">
                        <input type="file" accept="audio/*" onChange={handleAudioUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                        <div className="border-4 border-dashed border-white/5 rounded-[32px] p-16 flex flex-col items-center justify-center gap-6 bg-white/5 group-hover:bg-white/10 group-hover:border-blue-500/30 transition-all">
                          <div className="w-24 h-24 bg-blue-600/10 rounded-[32px] flex items-center justify-center text-blue-500 group-hover:bg-blue-600 group-hover:text-white transition-all shadow-inner">
                            <Upload size={48} />
                          </div>
                          <div className="text-center">
                            <span className="text-xl font-bold text-white block">
                              {material.audioUrl ? "音频已成功就绪 ✅" : "点击或拖拽上传音频"}
                            </span>
                            {!material.audioUrl && <p className="text-slate-500 mt-2">推荐使用 192kbps 或以上采样率的 MP3</p>}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.3em] ml-1">材料标题</label>
                      <input 
                        value={material.title} 
                        onChange={e => setMaterial(p => ({...p, title: e.target.value}))} 
                        className="w-full h-20 bg-white/5 border border-white/10 rounded-[24px] px-8 text-2xl font-bold text-white focus:outline-none focus:ring-4 focus:ring-blue-500/10 transition-all"
                        placeholder="请输入听力材料标题"
                      />
                    </div>

                    <div className="pt-6">
                      <button 
                        disabled={!material.audioUrl}
                        onClick={() => setMode('edit')}
                        className="w-full h-20 bg-blue-600 hover:bg-blue-700 disabled:opacity-20 disabled:grayscale text-white rounded-[24px] font-black text-2xl shadow-2xl shadow-blue-600/30 transition-all flex items-center justify-center gap-4"
                      >
                        下一步：配置题目分段 <ArrowRight size={32} />
                      </button>
                    </div>
                  </div>
               </div>
            </motion.div>
          )}

          {mode === 'edit' && (
            <motion.div key="edit" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="grid grid-cols-1 2xl:grid-cols-12 gap-10">
              <div className="2xl:col-span-4 space-y-8">
                <div className="glass p-8 rounded-[40px] space-y-8">
                   <h3 className="text-xl font-bold text-white flex items-center gap-3">
                     <Clock size={24} className="text-blue-500" /> 播放控制器
                   </h3>
                   <div className="bg-slate-900/50 rounded-[32px] p-8 border border-white/5 space-y-8">
                      <div className="flex items-center justify-center gap-10">
                        <button onClick={() => skip(-10)} className="p-4 rounded-2xl bg-white/5 text-slate-400 hover:text-white transition-all"><Rewind size={32} /></button>
                        <button onClick={togglePlay} className="w-24 h-24 bg-blue-600 hover:bg-blue-700 rounded-full flex items-center justify-center text-white shadow-2xl shadow-blue-600/40 active:scale-90 transition-all">
                          {isPlaying ? <Pause size={48} /> : <Play size={48} className="translate-x-1" />}
                        </button>
                        <button onClick={() => skip(10)} className="p-4 rounded-2xl bg-white/5 text-slate-400 hover:text-white transition-all"><FastForward size={32} /></button>
                      </div>
                      <div className="space-y-4">
                         <div className="flex justify-between text-xs font-black text-slate-500 tracking-widest">
                           <span className="text-blue-500">{formatTime(currentTime)}</span>
                           <span>{formatTime(duration)}</span>
                         </div>
                         <input type="range" min="0" max={duration} value={currentTime} onChange={e => {
                           if(audioRef.current) audioRef.current.currentTime = parseFloat(e.target.value);
                         }} className="w-full h-2 bg-white/10 rounded-full appearance-none cursor-pointer accent-blue-500" />
                      </div>
                   </div>
                   <div className="grid grid-cols-1 gap-4">
                      <button 
                        onClick={async () => {
                          await manualSave();
                          alert('材料已成功保存并发布到共享库！');
                        }} 
                        className="h-20 bg-blue-600 hover:bg-blue-700 text-white rounded-[24px] font-black text-xl flex items-center justify-center gap-4 transition-all shadow-xl shadow-blue-600/30 active:scale-95"
                      >
                        <Save size={28} /> 保存并发布到库
                      </button>
                      <button onClick={extractSegmentsFromScript} className="h-16 btn-glass text-blue-400 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all"><CheckCircle2 size={20} /> 智能识别脚本</button>
                   </div>
                </div>

                <div className="glass p-8 rounded-[40px] flex flex-col h-[600px]">
                  <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-3">
                    <FileText size={24} className="text-blue-500" /> 脚本工作流
                  </h3>
                  <textarea 
                    value={material.script} 
                    onChange={e => setMaterial(p => ({...p, script: e.target.value}))}
                    className="flex-grow w-full bg-slate-900/50 border border-white/5 rounded-[24px] p-6 text-lg text-slate-300 outline-none focus:border-blue-500/30 transition-all resize-none custom-scrollbar"
                    placeholder="在此输入文本，系统会根据 [00:00] 格式自动切分题目..."
                  />
                </div>
              </div>

              <div className="2xl:col-span-8 space-y-8 flex flex-col h-full">
                 <div className="glass p-10 rounded-[48px] flex flex-grow flex-col h-full">
                    <div className="flex items-center justify-between mb-8">
                       <div>
                         <h3 className="text-3xl font-black text-white tracking-tight">题目明细编辑器</h3>
                         <p className="text-slate-400 mt-1">设置每道题目的开始结束时间及课文内容。</p>
                       </div>
                       <div className="flex gap-4">
                         <button onClick={clearAllSegments} className="px-6 h-14 btn-glass text-red-500 border-red-500/20 text-sm font-bold rounded-2xl flex items-center gap-2 uppercase tracking-widest"><Trash2 size={16}/> 全部清空</button>
                         <button onClick={() => setMaterial(p => ({
                            ...p,
                            segments: [...p.segments, { id: crypto.randomUUID(), label: `题目 ${p.segments.length+1}`, startTime: currentTime, endTime: Math.min(currentTime+10, duration), subtitle: '' }]
                         }))} className="px-6 h-14 bg-blue-600 text-white font-bold rounded-2xl flex items-center gap-3 shadow-xl transition-all"><Plus size={20}/> 新增题目</button>
                       </div>
                    </div>

                    <div className="flex-grow space-y-6 overflow-y-auto pr-4 custom-scrollbar max-h-[800px]">
                       {material.segments.map((seg, idx) => (
                         <div key={seg.id} className="p-8 bg-white/5 border border-white/5 rounded-[32px] group hover:border-white/10 transition-all grid grid-cols-1 xl:grid-cols-[1fr_2fr_auto] gap-8 items-start">
                            <div className="space-y-6">
                               <input value={seg.label} onChange={e => setMaterial(p => {const s=[...p.segments]; s[idx].label=e.target.value; return {...p, segments:s}})} className="text-2xl font-black text-white bg-transparent border-none outline-none w-full" />
                               <div className="grid grid-cols-2 gap-4">
                                  <div className="space-y-2">
                                    <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">开始 (秒)</span>
                                    <input type="number" value={Math.floor(seg.startTime)} onChange={e => setMaterial(p => {const s=[...p.segments]; s[idx].startTime=parseFloat(e.target.value); return {...p, segments:s}})} className="w-full h-14 bg-slate-900 rounded-xl px-4 text-white font-mono border border-white/5" />
                                  </div>
                                  <div className="space-y-2">
                                    <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">结束 (秒)</span>
                                    <input type="number" value={Math.floor(seg.endTime)} onChange={e => setMaterial(p => {const s=[...p.segments]; s[idx].endTime=parseFloat(e.target.value); return {...p, segments:s}})} className="w-full h-14 bg-slate-900 rounded-xl px-4 text-white font-mono border border-white/5" />
                                  </div>
                               </div>
                            </div>
                            <textarea value={seg.subtitle} onChange={e => setMaterial(p => {const s=[...p.segments]; s[idx].subtitle=e.target.value; return {...p, segments:s}})} className="w-full h-40 bg-slate-900 rounded-2xl p-6 text-lg text-slate-300 outline-none border border-white/5 focus:border-blue-500/20 resize-none" placeholder="输入段落文字..." />
                            <div className="flex flex-col gap-3">
                               <button onClick={() => { if(audioRef.current) audioRef.current.currentTime=seg.startTime; setIsPlaying(true); audioRef.current?.play(); }} className="w-16 h-16 bg-blue-600/10 text-blue-500 border border-blue-500/20 rounded-2xl flex items-center justify-center hover:bg-blue-600 hover:text-white transition-all"><Play size={24} className="translate-x-0.5" /></button>
                               <button onClick={() => setMaterial(p => ({...p, segments: p.segments.filter(s => s.id !== seg.id).map((s,i)=>({...s, label:`题目 ${i+1}`}))}))} className="w-16 h-16 bg-red-500/10 text-red-500 border border-red-500/20 rounded-2xl flex items-center justify-center hover:bg-red-500 hover:text-white transition-all"><Trash2 size={24} /></button>
                            </div>
                         </div>
                       ))}
                    </div>
                    <div className="mt-10">
                       <button onClick={() => setMode('train')} className="w-full h-20 bg-blue-600 hover:bg-blue-700 text-white rounded-[24px] font-black text-2xl shadow-xl transition-all pt-1 flex items-center justify-center gap-4"><CheckCircle2 size={32} /> 进入教学训练</button>
                    </div>
                 </div>
              </div>
            </motion.div>
          )}

          {mode === 'train' && (
            <motion.div key="train" initial={{ opacity: 0, scale: 1.02 }} animate={{ opacity: 1, scale: 1 }} className="space-y-12">
               {/* Training Player */}
               <div className="glass p-10 rounded-[56px] border-white/10 shadow-3xl relative">
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-1 bg-blue-500 rounded-full blur-[2px] opacity-50" />
                  <div className="flex flex-col gap-10">
                     <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
                        <div>
                           <span className="text-[10px] font-black text-blue-500 uppercase tracking-[0.4em] mb-2 block font-mono">Integrated Training Interface</span>
                           <h2 className="text-5xl font-black text-white tracking-tighter">{material.title}</h2>
                        </div>
                        <div className="glass-dark p-6 px-10 rounded-[32px] border-white/5 flex items-center gap-10">
                           <div className="flex flex-col">
                             <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest text-center mb-1">播放语速</span>
                             <span className="text-3xl font-black text-blue-400 font-mono text-center leading-none">{playbackSpeed.toFixed(1)}x</span>
                           </div>
                           <input type="range" min="0.5" max="2.5" step="0.1" value={playbackSpeed} onChange={e => setPlaybackSpeed(parseFloat(e.target.value))} className="w-48 h-2 bg-white/10 rounded-full appearance-none cursor-pointer accent-blue-500" />
                        </div>
                     </div>

                     <div className="bg-slate-950/60 rounded-[48px] p-12 border border-white/5 shadow-inner">
                        <div className="flex flex-col items-center gap-10">
                           <div className="flex items-center gap-12">
                              <button onClick={() => skip(-10)} className="w-20 h-20 bg-white/5 text-slate-500 hover:text-white rounded-[32px] flex items-center justify-center transition-all shadow-lg active:scale-90"><Rewind size={40} /></button>
                              <button onClick={togglePlay} className="w-32 h-32 bg-blue-600 hover:bg-blue-700 text-white rounded-full flex items-center justify-center shadow-[0_0_60px_rgba(37,99,235,0.4)] active:scale-90 transition-all">
                                {isPlaying ? <Pause size={64} /> : <Play size={64} className="translate-x-2" />}
                              </button>
                              <button onClick={() => skip(10)} className="w-20 h-20 bg-white/5 text-slate-500 hover:text-white rounded-[32px] flex items-center justify-center transition-all shadow-lg active:scale-90"><FastForward size={40} /></button>
                           </div>
                           <div className="w-full max-w-4xl space-y-4">
                              <input type="range" min="0" max={duration} value={currentTime} onChange={e => { if(audioRef.current) audioRef.current.currentTime = parseFloat(e.target.value); }} className="w-full h-3 bg-white/10 rounded-full appearance-none cursor-pointer accent-blue-500" />
                              <div className="flex justify-between px-2 text-sm font-black font-mono tracking-widest">
                                <span className="text-blue-500">{formatTime(currentTime)}</span>
                                <span className="text-slate-600">{formatTime(duration)}</span>
                              </div>
                           </div>
                        </div>
                     </div>
                  </div>
               </div>

               {/* Integrated Segment + Script View */}
               <div className="glass p-12 rounded-[56px] min-h-[600px] space-y-10">
                  <div className="flex items-center justify-between border-b border-white/5 pb-8">
                     <h3 className="text-3xl font-black text-white tracking-tight flex items-center gap-4">
                       <ListMusic size={32} className="text-blue-500" /> 交互教学脚本区
                     </h3>
                     <div className="flex items-center gap-6">
                        <button onClick={() => setSyncScroll(!syncScroll)} className={cn("text-sm font-bold uppercase tracking-widest flex items-center gap-2", syncScroll ? "text-blue-400" : "text-slate-500")}>
                           <CheckCircle2 size={16} /> 自动跟随
                        </button>
                        <button onClick={() => setShowSubtitles(!showSubtitles)} className={cn("text-sm font-bold uppercase tracking-widest flex items-center gap-2", showSubtitles ? "text-blue-400" : "text-slate-500")}>
                           {showSubtitles ? "显示原文" : "屏蔽原文"}
                        </button>
                     </div>
                  </div>

                  <div ref={transcriptRef} className="space-y-4 max-h-[800px] overflow-y-auto pr-4 custom-scrollbar">
                     {material.segments.map((seg, idx) => {
                       const isActive = activeSegmentIndex === idx;
                       return (
                         <motion.div 
                           key={seg.id}
                           data-segment-index={idx}
                           initial={false}
                           animate={{ 
                             backgroundColor: isActive ? 'rgba(37, 99, 235, 0.1)' : 'rgba(255, 255, 255, 0.02)',
                             borderColor: isActive ? 'rgba(37, 99, 235, 0.3)' : 'rgba(255, 255, 255, 0.05)'
                           }}
                           className={cn(
                             "p-8 rounded-[32px] border transition-all flex flex-col xl:flex-row items-center gap-10",
                             isActive ? "shadow-2xl shadow-blue-900/20" : ""
                           )}
                         >
                            <div className="flex items-center gap-6 min-w-[280px]">
                               <button 
                                 onClick={() => { if(audioRef.current) audioRef.current.currentTime=seg.startTime; setIsPlaying(true); audioRef.current?.play(); }}
                                 className={cn(
                                   "w-20 h-20 rounded-[24px] flex items-center justify-center transition-all shadow-xl shadow-blue-500/20",
                                   isActive ? "bg-blue-600 text-white" : "bg-white/5 text-slate-500 hover:bg-white/10"
                                 )}
                               >
                                  <Play size={32} className="translate-x-0.5" />
                               </button>
                               <div>
                                 <span className={cn("text-[10px] font-black uppercase tracking-widest block mb-1", isActive ? "text-blue-400" : "text-slate-600")}>SEGMENT {idx+1}</span>
                                 <h4 className={cn("text-2xl font-black tracking-tight", isActive ? "text-white" : "text-slate-400")}>{seg.label}</h4>
                                 <span className="text-xs font-mono text-slate-600">{formatTime(seg.startTime)} - {formatTime(seg.endTime)}</span>
                               </div>
                            </div>
                            
                            <div className="flex-grow w-full">
                               {isActive && showSubtitles ? (
                                  <div className="text-3xl font-medium leading-relaxed text-blue-100">
                                     {renderTranscript(true)}
                                  </div>
                               ) : (
                                  <div className={cn("text-xl font-medium leading-relaxed transition-all", isActive ? "text-blue-200/50" : "text-slate-700")}>
                                     {showSubtitles ? (seg.subtitle || "暂无脚本内容") : "••••••••••••••••••••••••••••••••••••"}
                                  </div>
                               )}
                            </div>
                         </motion.div>
                       );
                     })}
                  </div>
               </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Seewo Adaptability Styles */}
      <style>{`
        .app-bg {
          background-color: #020617;
          background-image: radial-gradient(circle at top left, #1e3a8a, transparent 40%), radial-gradient(circle at bottom right, #581c87, transparent 40%);
        }
        input[type="range"] {
          -webkit-appearance: none;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 999px;
        }
        input[type="range"]::-webkit-scrollbar {
          display: none;
        }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          height: 32px;
          width: 32px;
          border-radius: 999px;
          background: #3b82f6;
          cursor: pointer;
          box-shadow: 0 0 20px rgba(59, 130, 246, 0.4);
          border: 4px solid #fff;
        }
        .prose h2, .prose h3 { margin-top: 2rem !important; }
        .shadow-3xl { box-shadow: 0 40px 100px -20px rgba(0, 0, 0, 0.6); }
      `}</style>
    </div>
  );
}
