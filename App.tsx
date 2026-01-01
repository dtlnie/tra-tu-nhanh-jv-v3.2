import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Dictionary, TabType, WordEntry } from './types';
import { DEFAULT_DICTIONARY, DiscordIcon, SpeakerIcon } from './constants';
import { getSpeech } from './services/gemini';

function decodeBase64(base64: string) {
  const binaryString = window.atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

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
      if (!base64) { setPlaying(false); return; }

      const bytes = decodeBase64(base64);
      const buffer = await pcmToBuffer(bytes, ctx);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.onended = () => setPlaying(false);
      source.start(0);
    } catch (err) {
      console.error(err);
      setPlaying(false);
    }
  };

  return (
    <div className="bg-white rounded-xl p-4 md:p-5 mb-2 shadow-sm border border-slate-100 hover:border-blue-200 hover:shadow-md transition-all flex justify-between items-center group">
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <h3 className="text-lg md:text-xl font-bold text-slate-900 tracking-tight">{entry.jrai}</h3>
          <button 
            onClick={() => handlePlay(entry.jrai, false)} 
            className={`p-1.5 rounded-lg transition-colors ${playing ? 'text-blue-300' : 'text-blue-600 hover:bg-blue-50'}`}
          >
            <SpeakerIcon />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <p className="text-slate-500 font-medium text-xs md:text-sm">{entry.viet}</p>
          <button 
            onClick={() => handlePlay(entry.viet, true)} 
            className={`p-1 rounded-md transition-colors ${playing ? 'text-slate-300' : 'text-slate-400 hover:text-blue-500 hover:bg-blue-50'}`}
          >
            <SpeakerIcon />
          </button>
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
  const [isTestingMode, setIsTestingMode] = useState(false);

  const normalize = (str: string) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

  useEffect(() => {
    const saved = localStorage.getItem('jrai_dict_v3.2');
    if (saved) { try { setDictionary(JSON.parse(saved)); } catch (e) {} }
  }, []);

  useEffect(() => { localStorage.setItem('jrai_dict_v3.2', JSON.stringify(dictionary)); }, [dictionary]);

  const refreshQuiz = useCallback(() => {
    const keys = Object.keys(dictionary);
    const shuffled = [...keys].sort(() => 0.5 - Math.random());
    setQuizWords(shuffled.slice(0, 6).map(k => ({ 
      ...dictionary[k], 
      questionSide: Math.random() > 0.5 ? 'jrai' : 'viet', 
      userInput: '', 
      status: 'none', 
      isTesting: false 
    })));
    setIsTestingMode(false);
  }, [dictionary]);

  useEffect(() => { if (activeTab === TabType.LEARN) refreshQuiz(); }, [activeTab, refreshQuiz]);

  const startTest = () => {
    setQuizWords(prev => prev.map(it => ({ ...it, isTesting: true, status: 'none', userInput: '' })));
    setIsTestingMode(true);
  };

  const checkResults = () => {
    setQuizWords(prev => prev.map(item => {
      const target = item.questionSide === 'jrai' ? item.viet : item.jrai;
      return {
        ...item,
        status: normalize(item.userInput) === normalize(target) ? 'correct' : 'wrong'
      };
    }));
  };

  const getFilteredResults = () => {
    const q = searchQuery.trim();
    if (!q) return [];
    
    const allWords = Object.values(dictionary) as WordEntry[];
    const exact = allWords.filter(w => normalize(w.jrai) === normalize(q) || normalize(w.viet) === normalize(q));
    if (exact.length > 0) return exact;

    const fuzzy = allWords.filter(w => normalize(w.jrai).includes(normalize(q)) || normalize(w.viet).includes(normalize(q)));
    return fuzzy;
  };

  const filteredResults = getFilteredResults();

  const handleExport = () => {
    const customWords = Object.fromEntries(
      Object.entries(dictionary).filter(([key]) => !DEFAULT_DICTIONARY[key])
    );
    
    if (Object.keys(customWords).length === 0) {
      alert("Bạn chưa thêm từ vựng mới nào để xuất!");
      return;
    }

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(customWords, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "tu_vung_da_them.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 pb-20 font-inter">
      <div className="max-w-4xl mx-auto px-4 pt-6 md:pt-10">
        
        {/* Compact Header */}
        <header className="mb-6 flex flex-col md:flex-row justify-between items-center gap-4 text-center md:text-left">
          <div>
            <h1 className="text-3xl md:text-4xl font-black text-slate-900 tracking-tight leading-none mb-1">
              JRAI<span className="text-blue-600">VIỆT</span>
            </h1>
            <p className="text-slate-500 font-bold text-[10px] md:text-xs opacity-80 uppercase tracking-widest">Tra Cứu Từ Nhanh Jrai-Việt v3.2</p>
          </div>
          <div className="max-w-xs md:text-right hidden sm:block">
            <p className="text-slate-400 text-[10px] font-semibold leading-tight uppercase">Công cụ bảo tồn ngôn ngữ và văn hóa dân tộc Jrai.</p>
          </div>
        </header>

        {/* Streamlined Nav */}
        <nav className="flex bg-white p-1 rounded-xl shadow-sm border border-slate-200 mb-6 overflow-x-auto no-scrollbar scroll-smooth">
          {(Object.values(TabType) as TabType[]).map(tab => (
            <button 
              key={tab} 
              onClick={() => setActiveTab(tab)} 
              className={`flex-1 min-w-[90px] py-3 rounded-lg font-bold text-[10px] uppercase tracking-wider transition-all duration-200 ${activeTab === tab ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50/50'}`}
            >
              {tab}
            </button>
          ))}
        </nav>

        <main className="animate-in fade-in slide-in-from-bottom-2 duration-300">
          {activeTab === TabType.SEARCH && (
            <div className="max-w-3xl mx-auto">
              <div className="relative mb-6">
                <div className="absolute inset-y-0 left-5 flex items-center pointer-events-none">
                  <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                </div>
                <input 
                  type="text" 
                  placeholder="Nhập từ cần tra cứu..." 
                  className="w-full pl-12 p-4 md:p-5 rounded-xl border border-slate-200 shadow-sm bg-white font-semibold text-base md:text-xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-600 outline-none transition-all placeholder:text-slate-300"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {searchQuery.trim() ? (
                  filteredResults.length > 0 ? (
                    filteredResults.map((w, i) => <WordCard key={i} entry={w} />)
                  ) : (
                    <div className="col-span-full py-12 px-6 text-center bg-white rounded-2xl border border-dashed border-slate-200">
                      <p className="font-bold text-slate-500 text-base mb-4 leading-relaxed">
                        Từ chưa có trong từ điển vui lòng đợi admin cập nhật.<br/>
                        <span className="text-xs font-medium text-slate-400 mt-1 block">Gợi ý: bạn có thể thêm trực tiếp hoặc liên hệ admin.</span>
                      </p>
                      <button onClick={() => setActiveTab(TabType.MANAGE)} className="bg-blue-600 text-white px-6 py-2.5 rounded-lg font-bold uppercase text-[10px] hover:bg-blue-700 transition-all shadow-md">Thêm từ mới</button>
                    </div>
                  )
                ) : (
                  <div className="col-span-full py-24 text-center select-none opacity-20">
                    <div className="text-5xl mb-4">🔍</div>
                    <p className="font-bold text-slate-400 uppercase tracking-[0.3em] text-[10px]">Tra cứu dữ liệu Jrai</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === TabType.LEARN && (
            <div className="max-w-4xl mx-auto">
              {!isTestingMode ? (
                <div>
                  <div className="flex flex-col sm:flex-row justify-between items-center mb-6 p-5 bg-white rounded-2xl shadow-sm border border-slate-200">
                    <div className="text-center sm:text-left mb-3 sm:mb-0">
                      <h2 className="font-black text-slate-900 text-lg mb-0.5">Ghi nhớ từ vựng</h2>
                      <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">Học nhanh 6 từ vựng mỗi ngày</p>
                    </div>
                    <button onClick={refreshQuiz} className="bg-slate-100 text-slate-600 px-6 py-2.5 rounded-lg font-bold text-[10px] uppercase hover:bg-slate-200 transition-all">Đổi bộ từ</button>
                  </div>
                  
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
                    {quizWords.map((item, i) => (
                      <div key={i} className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm flex flex-col items-center justify-center text-center min-h-[140px] hover:shadow-md transition-shadow">
                        <h3 className="text-xl md:text-2xl font-black text-blue-600 mb-2">{item.jrai}</h3>
                        <div className="h-0.5 w-6 bg-slate-100 mb-2 rounded-full"></div>
                        <p className="text-slate-500 font-bold uppercase text-[10px] tracking-widest">{item.viet}</p>
                      </div>
                    ))}
                  </div>

                  <div className="text-center py-8 bg-blue-50/50 rounded-2xl border border-blue-100">
                    <p className="font-bold text-blue-900 text-sm mb-4">Bạn đã học xong? Kiểm tra thử ngay.</p>
                    <button onClick={startTest} className="bg-blue-600 text-white px-10 py-4 rounded-xl font-black text-[11px] uppercase tracking-widest shadow-lg shadow-blue-500/10 hover:scale-105 transition-all">Bắt đầu bài thi</button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex flex-col sm:flex-row justify-between items-center mb-6 p-5 bg-slate-900 rounded-2xl shadow-lg text-white">
                    <div className="text-center sm:text-left mb-4 sm:mb-0">
                      <h2 className="font-black text-white text-lg italic">Đang Kiểm Tra</h2>
                      <p className="text-blue-400 text-[9px] font-bold uppercase tracking-widest">Nhập đáp án chính xác</p>
                    </div>
                    <div className="flex gap-2 w-full sm:w-auto">
                      <button onClick={checkResults} className="flex-1 bg-emerald-500 text-white px-6 py-3 rounded-lg font-bold text-[10px] uppercase hover:bg-emerald-600 shadow-lg shadow-emerald-500/10">Nộp bài</button>
                      <button onClick={refreshQuiz} className="flex-1 bg-white/10 text-white px-6 py-3 rounded-lg font-bold text-[10px] uppercase hover:bg-white/20">Hủy</button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {quizWords.map((item, i) => (
                      <div key={i} className={`bg-white rounded-2xl p-6 border-2 transition-all min-h-[180px] flex flex-col items-center justify-center relative ${item.status === 'correct' ? 'border-emerald-500 shadow-emerald-500/5' : item.status === 'wrong' ? 'border-red-400 bg-red-50/10' : 'border-slate-100'}`}>
                        <div className="w-full space-y-4">
                          <div className="text-center">
                            <p className="text-blue-500 font-bold text-[9px] uppercase tracking-widest mb-1">Dịch sang {item.questionSide === 'jrai' ? 'Việt' : 'Jrai'}:</p>
                            <p className="font-black text-slate-900 text-xl">{item.questionSide === 'jrai' ? item.jrai : item.viet}</p>
                          </div>
                          <input 
                            type="text" 
                            className={`w-full p-3 border-2 rounded-xl text-center font-bold text-base outline-none transition-all ${item.status === 'correct' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : item.status === 'wrong' ? 'border-red-500 bg-red-50 text-red-700' : 'border-slate-50 focus:border-blue-500 bg-slate-50/50 focus:bg-white'}`}
                            placeholder="Trả lời..."
                            value={item.userInput}
                            onChange={(e) => { const n = [...quizWords]; n[i].userInput = e.target.value; n[i].status = 'none'; setQuizWords(n); }}
                          />
                          {item.status === 'wrong' && (
                            <div className="animate-in fade-in duration-300">
                               <p className="text-red-700 font-black text-center text-xs italic">{item.questionSide === 'jrai' ? item.viet : item.jrai}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === TabType.MANAGE && (
            <div className="max-w-md mx-auto py-4">
              <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
                 <h2 className="text-xl font-black text-slate-900 mb-6 text-center uppercase tracking-tight">Thêm Từ Mới</h2>
                 <div className="space-y-4">
                   <div className="space-y-1">
                     <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Từ tiếng Jrai</label>
                     <input id="new-jrai" type="text" placeholder="Ví dụ: Aba" className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 focus:ring-4 focus:ring-blue-500/10 focus:bg-white focus:border-blue-600 outline-none font-bold transition-all text-sm" />
                   </div>
                   <div className="space-y-1">
                     <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Nghĩa tiếng Việt</label>
                     <input id="new-viet" type="text" placeholder="Ví dụ: Con ba ba" className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 focus:ring-4 focus:ring-blue-500/10 focus:bg-white focus:border-blue-600 outline-none font-bold transition-all text-sm" />
                   </div>
                   <button onClick={() => {
                     const j = (document.getElementById('new-jrai') as HTMLInputElement).value;
                     const v = (document.getElementById('new-viet') as HTMLInputElement).value;
                     if (j && v) { setDictionary(prev => ({...prev, [normalize(j)]: {jrai: j, viet: v}})); alert("Đã thêm từ vựng thành công!"); (document.getElementById('new-jrai') as HTMLInputElement).value = ''; (document.getElementById('new-viet') as HTMLInputElement).value = ''; }
                   }} className="w-full bg-slate-900 text-white py-4 rounded-xl font-bold uppercase tracking-widest shadow-md hover:bg-blue-600 transition-all text-[11px]">Lưu từ vựng</button>
                 </div>
              </div>
            </div>
          )}

          {activeTab === TabType.DATA && (
             <div className="max-w-3xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-4 py-4">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 text-center flex flex-col items-center">
                  <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mb-4">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                  </div>
                  <h3 className="font-bold text-slate-800 uppercase text-[11px] mb-2">Xuất Dữ Liệu Tự Thêm</h3>
                  <p className="text-[9px] text-slate-400 mb-6 px-2 font-medium leading-relaxed">Chỉ xuất các từ vựng bạn đã thêm thủ công.</p>
                  <button onClick={handleExport} className="w-full py-4 bg-blue-600 text-white rounded-xl font-bold uppercase text-[9px] hover:bg-blue-700 transition-all shadow-md">Tải xuống file JSON</button>
                </div>
                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 text-center flex flex-col justify-center items-center">
                  <div className="w-12 h-12 bg-white text-red-500 rounded-full flex items-center justify-center mb-4 shadow-sm">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                  </div>
                  <h3 className="font-bold text-slate-500 uppercase text-[11px] mb-2 tracking-widest">Khôi Phục Mặc Định</h3>
                  <button onClick={() => confirm("Xác nhận Reset toàn bộ?") && setDictionary(DEFAULT_DICTIONARY)} className="bg-white text-red-600 border border-red-100 py-4 px-6 rounded-xl font-bold uppercase text-[9px] hover:bg-red-50 transition-all shadow-sm">Reset Hệ Thống</button>
                </div>
             </div>
          )}
        </main>

        <footer className="mt-10 pt-8 border-t border-slate-200">
          <div className="flex flex-col md:flex-row justify-between items-start gap-8 mb-10">
            <div className="max-w-md">
              <h4 className="text-slate-900 font-black text-lg mb-2 tracking-tight italic uppercase">Tra Cứu Từ Nhanh <span className="text-blue-600">Jrai-Việt</span></h4>
              <p className="text-slate-500 text-[11px] leading-relaxed mb-4 font-medium italic">Phiên bản v3.2. Chung tay bảo tồn văn hóa ngôn ngữ Jrai.</p>
              <p className="text-[9px] text-slate-300 font-bold uppercase tracking-[0.2em]">© 2025 Jrai-Viet Project.</p>
            </div>
            
            <div className="w-full md:w-auto">
              <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4 block text-center md:text-left">Hỗ trợ & Kết nối</span>
                <div className="flex flex-col sm:flex-row gap-3">
                  <a 
                    href="https://discord.gg/TpjGV3EHt" 
                    target="_blank" 
                    className="flex items-center justify-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-xl hover:bg-blue-700 transition-all active:scale-95 group shadow-md"
                  >
                    <DiscordIcon />
                    <span className="text-[11px] font-black uppercase tracking-wider">Tham gia cộng đồng</span>
                  </a>
                  <a 
                    href="https://discord.gg/2qK6P5FW" 
                    target="_blank" 
                    className="flex items-center justify-center gap-2 bg-emerald-500 text-white px-6 py-3 rounded-xl hover:bg-emerald-600 transition-all active:scale-95 group shadow-md"
                  >
                    <DiscordIcon />
                    <span className="text-[11px] font-black uppercase tracking-wider">Liên hệ Admin</span>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default App;
