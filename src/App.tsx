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
  Save
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { AudioSegment, ListeningMaterial } from './types';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [mode, setMode] = useState<'setup' | 'edit' | 'train'>('setup');
  const [material, setMaterial] = useState<ListeningMaterial>({
    title: '未命名听力材料',
    audioUrl: '',
    script: '',
    segments: [],
  });

  const [lastSaved, setLastSaved] = useState<string | null>(null);

  // Persistence: Load from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('echomaster_material');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Note: Blob URLs won't persist across refreshes, so we'll need to warn if audioUrl is present but invalid
        setMaterial(parsed);
      } catch (e) {
        console.error("Persistence Load Error", e);
      }
    }
  }, []);

  // Persistence: Save function
  const manualSave = () => {
    localStorage.setItem('echomaster_material', JSON.stringify(material));
    setLastSaved(new Date().toLocaleTimeString());
  };

  // Auto-save debounced or just on change for safer experience
  useEffect(() => {
    if (material.audioUrl || material.script || material.segments.length > 0) {
      const timer = setTimeout(() => {
        localStorage.setItem('echomaster_material', JSON.stringify(material));
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [material]);

  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number | null>(null);
  const [showSubtitles, setShowSubtitles] = useState(true);
  const [syncScroll, setSyncScroll] = useState(true);
  const transcriptRef = useRef<HTMLDivElement>(null);

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
    };
  }, [material.segments, mode, activeSegmentIndex]);

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

  return (
    <div className="min-h-screen font-sans selection:bg-blue-500/30 selection:text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 glass border-b border-white/10">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold shadow-lg shadow-blue-600/30">
              E
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white leading-none">EchoMaster Pro</h1>
              <p className="text-[10px] text-blue-400 font-bold uppercase tracking-[0.2em] mt-1">High School Listening Lab</p>
            </div>
          </div>

          <nav className="flex items-center gap-3">
            {lastSaved && (
              <span className="text-[10px] font-bold text-green-500 uppercase tracking-tighter opacity-70">
                {lastSaved} 已保存
              </span>
            )}
            <button 
              onClick={manualSave}
              className="btn-glass p-2.5 rounded-xl text-blue-400 hover:text-white transition-all group"
              title="保存当前进度"
            >
              <Save size={18} className="group-active:scale-95" />
            </button>
            <div className="w-[1px] h-6 bg-white/10 mx-1" />
            <button 
              onClick={() => setMode('setup')}
              className={cn(
                "px-5 py-2.5 text-sm font-medium transition-all rounded-xl flex items-center gap-2",
                mode === 'setup' ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20" : "btn-glass text-slate-300"
              )}
            >
              <Upload size={16} /> 设置
            </button>
            <button 
              onClick={() => setMode('edit')}
              className={cn(
                "px-5 py-2.5 text-sm font-medium transition-all rounded-xl flex items-center gap-2",
                mode === 'edit' ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20" : "btn-glass text-slate-300"
              )}
            >
              <Settings2 size={16} /> 分段
            </button>
            <button 
              onClick={() => setMode('train')}
              className={cn(
                "px-5 py-2.5 text-sm font-medium transition-all rounded-xl flex items-center gap-2",
                mode === 'train' ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20" : "btn-glass text-slate-300"
              )}
            >
              <BookOpen size={16} /> 训练
            </button>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-10">
        <AnimatePresence mode="wait">
          {mode === 'setup' && (
            <motion.div 
              key="setup"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="max-w-2xl mx-auto space-y-8"
            >
              <div className="glass p-10 rounded-[32px] space-y-8">
                <div className="space-y-2">
                  <h2 className="text-3xl font-bold text-white">开始新的听力任务</h2>
                  <p className="text-slate-400 text-sm">上传音频文件并粘贴听力脚本。</p>
                </div>

                <div className="space-y-6">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-3">音频文件 (MP3/WAV)</label>
                    <div className="relative group">
                      <input 
                        type="file" 
                        accept="audio/*" 
                        onChange={handleAudioUpload}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                      />
                      <div className="border border-white/10 rounded-2xl p-10 flex flex-col items-center justify-center gap-4 bg-white/5 hover:bg-white/10 transition-all group-hover:border-blue-500/50">
                        <div className="w-14 h-14 bg-white/5 rounded-2xl flex items-center justify-center text-slate-400 group-hover:bg-blue-600 group-hover:text-white transition-all shadow-inner">
                          <ListMusic size={28} />
                        </div>
                        <span className="text-sm font-medium text-slate-300">
                          {material.audioUrl ? "音频已成功上传 ✅" : "点击或拖拽上传音频"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-3">听力脚本 (MARKDOWN)</label>
                    <textarea 
                      value={material.script}
                      onChange={(e) => setMaterial(prev => ({ ...prev, script: e.target.value }))}
                      placeholder="在此处输入脚本... 提示：[00:01] 标识分段开始时间"
                      className="w-full h-72 bg-white/5 border border-white/10 rounded-2xl p-5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all resize-none"
                    />
                  </div>

                  <div className="pt-4 space-y-3">
                    <button 
                      disabled={!material.audioUrl}
                      onClick={() => setMode('edit')}
                      className="w-full h-14 bg-blue-600 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-blue-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-600/30"
                    >
                      下一步：配置分段 <ArrowRight size={20} />
                    </button>

                    <button 
                      onClick={() => {
                        setMaterial({
                          title: 'Daily Life: Ordering at a Coffee Shop',
                          audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
                          script: `### English Dialogue: At the Coffee Shop\n\n[00:00] **Barista**: Next in line, please! Hi there, what can I get started for you today?\n**Customer**: Hi! Can I get a large iced latte, please?\n**Barista**: Sure thing. Would you like any flavor in that? We have vanilla, caramel, and hazelnut.\n\n[00:10] **Customer**: Hmm, I'll go with caramel. And could I have that with oat milk instead of whole milk?\n**Barista**: You got it. One large iced caramel latte with oat milk. Anything else for you?\n\n[00:20] **Customer**: Actually, yes. Do you have any of those blueberry muffins left?\n**Barista**: Let me check... Yes, we have two left! Would you like me to warm one up for you?\n\n[00:30] **Customer**: That sounds perfect, thank you. How much will that be?\n**Barista**: That'll be $8.50 altogether. You can tap your card right here whenever you're ready.\n\n[00:40] **Customer**: Here you go. Thanks!\n**Barista**: Great, thanks. Your drink will be ready at the end of the counter in just a few minutes. Have a great day!\n**Customer**: You too!`,
                          segments: [
                            { id: '1', label: '题目 1: Ordering Drink', startTime: 0, endTime: 10, subtitle: '**Barista**: Next in line, please! Hi there, what can I get started for you today?\n**Customer**: Hi! Can I get a large iced latte, please?\n**Barista**: Sure thing. Would you like any flavor in that? We have vanilla, caramel, and hazelnut.' },
                            { id: '2', label: '题目 2: Substitution', startTime: 10, endTime: 20, subtitle: '**Customer**: Hmm, I\'ll go with caramel. And could I have that with oat milk instead of whole milk?\n**Barista**: You got it. One large iced caramel latte with oat milk. Anything else for you?' },
                            { id: '3', label: '题目 3: Adding Food', startTime: 20, endTime: 30, subtitle: '**Customer**: Actually, yes. Do you have any of those blueberry muffins left?\n**Barista**: Let me check... Yes, we have two left! Would you like me to warm one up for you?' },
                            { id: '4', label: '题目 4: Payment', startTime: 30, endTime: 40, subtitle: '**Customer**: That sounds perfect, thank you. How much will that be?\n**Barista**: That\'ll be $8.50 altogether. You can tap your card right here whenever you\'re ready.' },
                            { id: '5', label: '题目 5: Closing', startTime: 40, endTime: 55, subtitle: '**Customer**: Here you go. Thanks!\n**Barista**: Great, thanks. Your drink will be ready at the end of the counter in just a few minutes. Have a great day!\n**Customer**: You too!' },
                          ]
                        });
                        setMode('edit');
                      }}
                      className="w-full h-14 btn-glass text-slate-300 rounded-2xl font-bold flex items-center justify-center gap-2"
                    >
                      加载演示案例
                    </button>
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
              className="grid grid-cols-1 lg:grid-cols-12 gap-8"
            >
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
                               <span className="text-slate-500 font-bold tracking-widest">START</span>
                               <input 
                                 type="number" step="1" 
                                 value={Math.floor(seg.startTime)}
                                 onChange={(e) => {
                                   const newSegs = [...material.segments];
                                   newSegs[idx].startTime = parseFloat(e.target.value);
                                   setMaterial(p => ({ ...p, segments: newSegs }));
                                 }}
                                 className="w-full p-2 bg-black/20 border border-white/5 rounded-lg text-white focus:border-blue-500/50 outline-none"
                               />
                             </div>
                             <div className="space-y-1.5">
                               <span className="text-slate-500 font-bold tracking-widest">END</span>
                               <input 
                                 type="number" step="1"
                                 value={Math.floor(seg.endTime)} 
                                 onChange={(e) => {
                                   const newSegs = [...material.segments];
                                   newSegs[idx].endTime = parseFloat(e.target.value);
                                   setMaterial(p => ({ ...p, segments: newSegs }));
                                 }}
                                 className="w-full p-2 bg-black/20 border border-white/5 rounded-lg text-white focus:border-blue-500/50 outline-none"
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
                
                <div className="flex flex-col gap-8">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="space-y-1">
                      <span className="text-[9px] font-black text-blue-500 uppercase tracking-[0.4em]">Integrated Listening System</span>
                      <h2 className="text-3xl font-black tracking-tighter text-white leading-tight">
                        练习工作台
                      </h2>
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
                        <div className="flex items-center gap-8">
                          <button onClick={() => skip(-10)} className="w-12 h-12 rounded-full flex items-center justify-center text-slate-500 glass hover:text-white transition-all">
                            <Rewind size={24} />
                          </button>
                          <button 
                            onClick={togglePlay} 
                            className="w-20 h-20 bg-blue-600 rounded-full flex items-center justify-center text-white shadow-[0_0_40px_rgba(37,99,235,0.4)] hover:scale-105 active:scale-95 transition-all"
                          >
                            {isPlaying ? <Pause size={32} /> : <Play size={32} className="translate-x-1" />}
                          </button>
                          <button onClick={() => skip(10)} className="w-12 h-12 rounded-full flex items-center justify-center text-slate-500 glass hover:text-white transition-all">
                            <FastForward size={24} />
                          </button>
                        </div>

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
                            "w-full px-5 py-4 rounded-2xl flex items-center justify-between border transition-all text-left text-sm group",
                            activeSegmentIndex === idx 
                              ? "bg-blue-600/20 border-blue-500/50 text-white shadow-lg shadow-blue-500/5" 
                              : "bg-white/5 border-white/5 text-slate-400 hover:border-white/20"
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <span className={cn(
                              "w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold",
                              activeSegmentIndex === idx ? "bg-blue-500 text-white" : "bg-white/10 text-slate-500"
                            )}>{idx + 1}</span>
                            <span className="font-bold">{seg.label}</span>
                          </div>
                          <span className="text-[10px] font-mono opacity-50">{formatTime(seg.startTime)}</span>
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
                        <h3 className="font-bold text-white">当前题目脚本</h3>
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
                        <button 
                          onClick={() => setSyncScroll(!syncScroll)}
                          className={cn(
                            "px-4 py-2 text-[10px] font-bold rounded-xl transition-all border",
                            syncScroll ? "bg-blue-600 border-blue-500 text-white" : "btn-glass border-white/5 text-slate-500"
                          )}
                        >
                          同步滚动：{syncScroll ? "开" : "关"}
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

      <audio 
        ref={audioRef}
        src={material.audioUrl}
      />

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
