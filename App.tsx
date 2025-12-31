import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Dictionary, TabType, WordEntry } from './types';
import { DEFAULT_DICTIONARY, DiscordIcon, SpeakerIcon } from './constants';
import { getSpeech } from './services/gemini';

// Giải mã Base64 thủ công theo quy định SDK
function decodeBase64(base64: string) {
  const binaryString = window.atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Chuyển PCM sang AudioBuffer
async function pcmToBuffer(data: Uint8Array, ctx: AudioContext): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
  const channelData = buffer.getChannelData(0);
  for (let i = 0; i < dataInt16.length; i++) {
    channelData[i] = dataInt16[i] / 32768.0;
  }
  return buffer;
}

interface QuizItem extends WordEntry {
  questionSide: 'jrai' | 'viet';
  userInput: string;
  status: 'none' | 'correct' | 'wrong';
  isTesting: boolean;
}

const WordCard: React.FC<{ entry: WordEntry }> = ({ entry }) => {
  const [playing, setPlaying] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const handlePlay = async (text: string, isViet: boolean) => {
    if (playing) return;
    try {
      setPlaying(true);
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') await ctx.resume();

      const base64 = await getSpeech(text, isViet);
      if (!base64) {
        setPlaying(false);
        return;
      }

      const bytes = decodeBase64(base64);
      const buffer = await pcmToBuffer(bytes, ctx);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.onended = () => setPlaying(false);
      source.start(0);
    } catch (err) {
      console.error("Audio Play Error:", err);
      setPlaying(false);
    }
  };

  return (
    <div className="bg-white rounded-xl p-4 md:p-5 mb-3 shadow-sm border-l-4 border-orange-600 hover:shadow-md transition-all group">
      <div className="flex justify-between items-center">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
            <h3 className="text-lg md:text-xl font-bold text-orange-900">{entry.jrai}</h3>
            <button 
              onClick={() => handlePlay(entry.jrai, false)}
              className={`p-2 rounded-full hover:bg-orange-100 transition-colors ${playing ? 'text-orange-300' : 'text-orange-600'}`}
              title="Nghe Jrai"
            >
              <SpeakerIcon />
            </button>
          </div>
          <div className="flex items-center gap-3">
            <p className="text-gray-600 font-medium text-sm md:text-base">{entry.viet}</p>
            <button 
              onClick={() => handlePlay(entry.viet, true)}
              className={`p-1.5 rounded-full hover:bg-orange-50 transition-colors ${playing ? 'text-gray-300' : 'text-gray-400'}`}
              title="Nghe Việt"
            >
              <SpeakerIcon />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const [dictionary, setDictionary] = useState<Dictionary>(DEFAULT_DICTIONARY);
  const [activeTab, setActiveTab] = useState<TabType>(TabType.SEARCH);
  const [searchQuery, setSearchQuery] = useState('');
  const [quizWords, setQuizWords] = useState<QuizItem[]>([]);
  const [securityKey, setSecurityKey] = useState('');

  const normalize = (str: string) => {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  };

  useEffect(() => {
    const saved = localStorage.getItem('jrai_dict_v1.6');
    if (saved) {
      try { setDictionary(JSON.parse(saved)); } catch (e) { console.error("Restore data failed"); }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('jrai_dict_v1.6', JSON.stringify(dictionary));
  }, [dictionary]);

  const refreshQuiz = useCallback(() => {
    const keys = Object.keys(dictionary);
    const shuffled = [...keys].sort(() => 0.5 - Math.random());
    const items: QuizItem[] = shuffled.slice(0, 6).map(k => ({
      ...dictionary[k],
      questionSide: 'jrai',
      userInput: '',
      status: 'none',
      isTesting: false
    }));
    setQuizWords(items);
  }, [dictionary]);

  useEffect(() => {
    if (activeTab === TabType.LEARN) refreshQuiz();
  }, [activeTab, refreshQuiz]);

  const filteredResults: WordEntry[] = searchQuery.trim() 
    ? (Object.values(dictionary) as WordEntry[]).filter((w: WordEntry) => 
        normalize(w.jrai).includes(normalize(searchQuery)) || 
        normalize(w.viet).includes(normalize(searchQuery))
      )
    : [];

  return (
    <div className="min-h-screen bg-[#fdfaf6] selection:bg-orange-200">
      <div className="max-w-5xl mx-auto px-4 py-6 md:py-10 pb-36">
        {/* Header - Compact on mobile, spacious on desktop */}
        <header className="bg-gradient-to-br from-orange-700 to-orange-500 text-white p-6 md:p-12 rounded-[2rem] shadow-2xl text-center mb-8 md:mb-12 relative overflow-hidden">
          <div className="relative z-10">
            <h1 className="text-3xl md:text-5xl font-black tracking-tight uppercase mb-2">Jrai - Việt</h1>
            <p className="text-xs md:text-sm text-orange-100 font-bold uppercase tracking-widest opacity-90">Từ điển & Học tập bỏ túi</p>
          </div>
          <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-3xl"></div>
        </header>

        {/* Navigation Tabs - Full width for desktop, scrollable for mobile */}
        <nav className="flex bg-white p-1.5 rounded-2xl shadow-lg mb-8 md:mb-12 border border-orange-50 sticky top-4 z-40 backdrop-blur-md bg-white/90">
          {(Object.values(TabType) as TabType[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 min-w-[70px] py-3 md:py-4 px-2 rounded-xl font-black transition-all text-[10px] md:text-xs uppercase tracking-tighter md:tracking-widest ${
                activeTab === tab ? 'bg-orange-600 text-white shadow-md' : 'text-gray-400 hover:text-orange-600 hover:bg-orange-50'
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>

        {/* Content Area */}
        <main className="animate-in fade-in duration-500">
          {activeTab === TabType.SEARCH && (
            <div className="max-w-3xl mx-auto">
              <div className="relative mb-10 group">
                <input 
                  type="text" 
                  placeholder="Tìm kiếm từ vựng..."
                  className="w-full p-5 md:p-6 rounded-2xl border-none ring-4 ring-orange-100 focus:ring-orange-500 outline-none transition-all shadow-xl bg-white font-bold text-gray-800 text-lg md:text-xl placeholder:text-gray-300"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <div className="absolute right-6 top-1/2 -translate-y-1/2 text-orange-200 group-focus-within:text-orange-500 transition-colors">
                  <svg className="w-6 h-6 md:w-8 md:h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                </div>
              </div>

              <div className="space-y-4">
                {searchQuery.trim() ? (
                  filteredResults.length > 0 ? (
                    filteredResults.map((w, i) => <WordCard key={i} entry={w} />)
                  ) : (
                    <div className="bg-white p-12 rounded-3xl border-2 border-dashed border-orange-200 text-center">
                      <p className="text-orange-800 font-black text-lg">Hệ thống chưa có từ này</p>
                      <p className="text-sm text-gray-400 mt-2 font-medium italic">Bạn có thể tự thêm từ mới ở tab Quản Lý.</p>
                    </div>
                  )
                ) : (
                  <div className="text-center py-24">
                    <div className="text-6xl md:text-8xl mb-6 grayscale opacity-20">📖</div>
                    <p className="text-gray-300 font-black uppercase tracking-widest text-sm">Nhập từ vựng để bắt đầu</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === TabType.LEARN && (
            <div className="space-y-8">
              <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-orange-600 p-6 rounded-3xl shadow-xl text-white">
                <div>
                  <h2 className="text-lg md:text-xl font-black uppercase">Thử thách ghi nhớ</h2>
                  <p className="text-[10px] md:text-xs font-bold opacity-80 uppercase tracking-widest">Học ngẫu nhiên 6 từ vựng</p>
                </div>
                <div className="flex gap-2 w-full md:w-auto">
                  <button onClick={() => setQuizWords(prev => prev.map(it => ({...it, isTesting: true, questionSide: Math.random() > 0.5 ? 'jrai' : 'viet', status: 'none', userInput: ''})))} className="flex-1 md:flex-none bg-white text-orange-600 px-6 py-3 rounded-xl font-black text-[10px] uppercase hover:scale-105 transition-all">Kiểm tra</button>
                  <button onClick={() => setQuizWords(prev => prev.map(it => { const target = it.questionSide === 'jrai' ? it.viet : it.jrai; return {...it, status: normalize(it.userInput) === normalize(target) ? 'correct' : 'wrong'}; }))} className="flex-1 md:flex-none bg-orange-800 text-white px-6 py-3 rounded-xl font-black text-[10px] uppercase hover:scale-105 transition-all">Nộp bài</button>
                  <button onClick={refreshQuiz} className="flex-1 md:flex-none bg-black/20 text-white px-6 py-3 rounded-xl font-black text-[10px] uppercase hover:bg-black/30 transition-all">Đổi từ</button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {quizWords.map((item, i) => (
                  <div key={i} className="bg-white rounded-[2rem] p-8 shadow-lg border-b-8 border-orange-200 flex flex-col items-center justify-center min-h-[220px] transition-transform hover:-translate-y-2">
                    {!item.isTesting ? (
                      <div className="text-center">
                        <span className="text-[10px] font-black text-gray-300 uppercase mb-4 block tracking-widest">Từ số {i+1}</span>
                        <h3 className="text-3xl font-black text-orange-900 mb-2">{item.jrai}</h3>
                        <div className="h-1.5 w-12 bg-orange-100 mx-auto mb-4 rounded-full"></div>
                        <p className="text-gray-500 font-bold text-lg uppercase tracking-tight">{item.viet}</p>
                      </div>
                    ) : (
                      <div className="w-full space-y-5">
                        <div className="flex justify-between items-center text-[10px] font-black uppercase text-gray-300">
                          <span>Câu {i+1}</span>
                          <span className="text-orange-400 italic">Dịch {item.questionSide === 'jrai' ? 'Việt' : 'Jrai'}</span>
                        </div>
                        <div className="text-2xl font-black text-center text-orange-900 uppercase">
                          {item.questionSide === 'jrai' ? item.jrai : item.viet}
                        </div>
                        <input 
                          type="text"
                          className={`w-full p-4 border-2 rounded-2xl outline-none transition-all font-bold text-center ${
                            item.status === 'correct' ? 'border-green-500 bg-green-50 text-green-700' : 
                            item.status === 'wrong' ? 'border-red-500 bg-red-50 text-red-700' : 'border-gray-100 focus:border-orange-500 bg-gray-50'
                          }`}
                          placeholder="Trả lời..."
                          value={item.userInput}
                          onChange={(e) => { const n = [...quizWords]; n[i].userInput = e.target.value; n[i].status = 'none'; setQuizWords(n); }}
                        />
                        {item.status === 'wrong' && <p className="text-[10px] text-red-400 font-bold text-center uppercase">Đúng là: {item.questionSide === 'jrai' ? item.viet : item.jrai}</p>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === TabType.MANAGE && (
            <div className="max-w-xl mx-auto py-6">
              <div className="bg-white p-8 md:p-12 rounded-[3rem] shadow-xl border border-orange-50">
                 <h2 className="text-2xl font-black text-gray-800 mb-10 uppercase text-center tracking-tight">Thêm từ vựng mới</h2>
                 <div className="space-y-8">
                   <div className="relative">
                     <label className="text-[10px] font-black text-gray-400 uppercase ml-4 mb-2 block">Từ tiếng Jrai</label>
                     <input id="new-jrai" type="text" className="w-full p-5 rounded-2xl bg-gray-50 border-none ring-2 ring-transparent focus:ring-orange-500 outline-none transition-all font-bold text-lg" />
                   </div>
                   <div className="relative">
                     <label className="text-[10px] font-black text-gray-400 uppercase ml-4 mb-2 block">Nghĩa tiếng Việt</label>
                     <input id="new-viet" type="text" className="w-full p-5 rounded-2xl bg-gray-50 border-none ring-2 ring-transparent focus:ring-orange-500 outline-none transition-all font-bold text-lg" />
                   </div>
                   <button 
                     onClick={() => {
                       const j = (document.getElementById('new-jrai') as HTMLInputElement).value;
                       const v = (document.getElementById('new-viet') as HTMLInputElement).value;
                       if (j && v) {
                         setDictionary(prev => ({...prev, [normalize(j)]: {jrai: j, viet: v}}));
                         (document.getElementById('new-jrai') as HTMLInputElement).value = '';
                         (document.getElementById('new-viet') as HTMLInputElement).value = '';
                         alert("Lưu thành công!");
                       }
                     }}
                     className="w-full bg-orange-600 text-white py-6 rounded-2xl font-black hover:bg-orange-700 shadow-2xl transition-all uppercase tracking-widest text-sm active:scale-95"
                   >
                     Cập nhật kho từ
                   </button>
                 </div>
              </div>
            </div>
          )}

          {activeTab === TabType.DATA && (
            <div className="py-6 space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="bg-white p-8 md:p-10 rounded-[2.5rem] shadow-lg border border-gray-100">
                  <h3 className="font-black text-orange-800 uppercase text-sm mb-6 flex items-center gap-2"><span>📥</span> Xuất dữ liệu</h3>
                  <div className="mb-6">
                    <label className="text-[10px] font-black text-gray-400 uppercase mb-2 block">Mã bảo mật Admin</label>
                    <input 
                      type="password"
                      placeholder="Mã số xuất file..."
                      className="w-full p-4 border-2 border-gray-50 rounded-2xl text-sm outline-none focus:border-orange-500 font-bold"
                      value={securityKey}
                      onChange={(e) => setSecurityKey(e.target.value)}
                    />
                  </div>
                  <button 
                    onClick={() => {
                      if (securityKey !== 'JRAI2025') { alert("Mã không đúng."); return; }
                      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(dictionary));
                      const link = document.createElement('a');
                      link.href = dataStr;
                      link.download = "jrai_dict_v1.json";
                      link.click();
                    }}
                    className="w-full py-5 bg-orange-100 text-orange-800 rounded-2xl font-black hover:bg-orange-200 transition-colors uppercase text-[10px] tracking-widest"
                  >
                    Tải về file JSON
                  </button>
                </div>

                <div className="bg-white p-8 md:p-10 rounded-[2.5rem] shadow-lg border border-gray-100 flex flex-col justify-between">
                  <div>
                    <h3 className="font-black text-orange-800 uppercase text-sm mb-4 flex items-center gap-2"><span>📤</span> Nhập dữ liệu</h3>
                    <p className="text-[10px] text-gray-400 font-bold mb-6 uppercase tracking-wider opacity-60">Dùng file đã lưu để khôi phục nhanh.</p>
                  </div>
                  <input 
                    type="file" 
                    accept=".json"
                    className="w-full text-xs text-gray-500 file:mr-4 file:py-3 file:px-6 file:rounded-full file:border-0 file:text-[10px] file:font-black file:bg-orange-50 file:text-orange-800 hover:file:bg-orange-100 cursor-pointer"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                          try {
                            const json = JSON.parse(ev.target?.result as string);
                            setDictionary(json);
                            alert("Đồng bộ hoàn tất!");
                          } catch (err) { alert("File không hợp lệ."); }
                        };
                        reader.readAsText(file);
                      }
                    }}
                  />
                </div>
              </div>

              <div className="bg-red-50 p-10 rounded-[2.5rem] border-2 border-red-100 text-center">
                <h3 className="font-black text-red-800 uppercase text-xs mb-3">Xóa toàn bộ dữ liệu</h3>
                <p className="text-[10px] text-red-600/70 mb-8 font-black uppercase tracking-widest italic">Mọi từ bạn tự thêm sẽ biến mất vĩnh viễn.</p>
                <button 
                  onClick={() => { if (confirm("Khôi phục cài đặt gốc?")) setDictionary(DEFAULT_DICTIONARY); }}
                  className="bg-red-600 text-white px-12 py-5 rounded-2xl font-black hover:bg-red-700 shadow-xl active:scale-95 transition-all text-[10px] uppercase tracking-[0.2em]"
                >
                  Reset Toàn Bộ
                </button>
              </div>
            </div>
          )}
        </main>

        {/* Floating Bottom Footer */}
        <footer className="fixed bottom-6 left-6 right-6 md:bottom-8 md:left-1/2 md:-translate-x-1/2 md:max-w-3xl bg-white/70 backdrop-blur-2xl border border-white/30 p-4 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] z-50">
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between px-2">
            <p className="text-[9px] md:text-[10px] text-gray-400 font-black uppercase tracking-tighter">© 2025 Jrai Dictionary - Version 1.6</p>
            <div className="flex gap-2 w-full sm:w-auto">
              <a href="https://discord.gg/TpjGV3EHt" target="_blank" rel="noopener noreferrer" className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-[#5865F2] text-white px-5 py-2.5 rounded-xl text-[9px] font-black uppercase hover:scale-105 transition-transform"><DiscordIcon /> Discord</a>
              <a href="https://discord.gg/2qK6P5FW" target="_blank" rel="noopener noreferrer" className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-gray-900 text-white px-5 py-2.5 rounded-xl text-[9px] font-black uppercase hover:scale-105 transition-transform"><DiscordIcon /> Admin</a>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default App;
