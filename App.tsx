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
    <div className="bg-white rounded-xl p-5 md:p-6 mb-3 shadow-sm border border-slate-100 hover:border-blue-200 hover:shadow-md transition-all flex justify-between items-center group">
      <div className="flex-1">
        <div className="flex items-center gap-3 mb-1">
          <h3 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight">{entry.jrai}</h3>
          <button 
            onClick={() => handlePlay(entry.jrai, false)} 
            className={`p-2 rounded-lg transition-colors ${playing ? 'text-blue-300' : 'text-blue-600 hover:bg-blue-50'}`}
          >
            <SpeakerIcon />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <p className="text-slate-500 font-medium text-sm md:text-base">{entry.viet}</p>
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
    // Chỉ xuất các từ vựng không nằm trong từ điển mặc định (tức là từ người dùng thêm)
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
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 pb-40 font-inter">
      <div className="max-w-5xl mx-auto px-4 pt-10 md:pt-16">
        
        <header className="mb-12 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="text-center md:text-left">
            <h1 className="text-4xl md:text-5xl font-black text-slate-900 tracking-tight leading-none mb-3">
              JRAI<span className="text-blue-600">VIỆT</span>
            </h1>
            <p className="text-slate-500 font-medium text-sm md:text-base opacity-80 uppercase tracking-widest">Tra Cứu Từ Nhanh Jrai-Việt v3.2</p>
          </div>
          <div className="hidden md:block h-12 w-px bg-slate-200"></div>
          <div className="max-w-xs text-center md:text-right">
            <p className="text-slate-400 text-xs font-semibold leading-relaxed uppercase">Công cụ bảo tồn ngôn ngữ và văn hóa dân tộc Jrai.</p>
          </div>
        </header>

        <nav className="flex bg-white p-1.5 rounded-2xl shadow-sm border border-slate-200 mb-12 overflow-x-auto no-scrollbar scroll-smooth">
          {(Object.values(TabType) as TabType[]).map(tab => (
            <button 
              key={tab} 
              onClick={() => setActiveTab(tab)} 
              className={`flex-1 min-w-[110px] py-4 rounded-xl font-bold text-xs uppercase tracking-wider transition-all duration-200 ${activeTab === tab ? 'bg-slate-900 text-white shadow-md' : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50/50'}`}
            >
              {tab}
            </button>
          ))}
        </nav>

        <main className="animate-in fade-in slide-in-from-bottom-3 duration-500">
          {activeTab === TabType.SEARCH && (
            <div className="max-w-4xl mx-auto">
              <div className="relative mb-10">
                <div className="absolute inset-y-0 left-6 flex items-center pointer-events-none">
                  <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                </div>
                <input 
                  type="text" 
                  placeholder="Nhập từ cần tra cứu..." 
                  className="w-full pl-16 p-5 md:p-7 rounded-2xl border border-slate-200 shadow-sm bg-white font-semibold text-lg md:text-2xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-600 outline-none transition-all placeholder:text-slate-300"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {searchQuery.trim() ? (
                  filteredResults.length > 0 ? (
                    filteredResults.map((w, i) => <WordCard key={i} entry={w} />)
                  ) : (
                    <div className="col-span-full py-20 px-10 text-center bg-white rounded-3xl border border-dashed border-slate-200">
                      <p className="font-bold text-slate-500 text-lg mb-6 leading-relaxed">
                        Từ chưa có trong từ điển vui lòng đợi admin cập nhật.<br/>
                        <span className="text-sm font-medium text-slate-400 mt-2 block">Gợi ý: bạn có thể thêm trực tiếp hoặc liên hệ admin.</span>
                      </p>
                      <button onClick={() => setActiveTab(TabType.MANAGE)} className="bg-blue-600 text-white px-8 py-3 rounded-xl font-bold uppercase text-xs hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/20">Thêm từ mới ngay</button>
                    </div>
                  )
                ) : (
                  <div className="col-span-full py-40 text-center select-none opacity-20">
                    <div className="text-6xl mb-6">🔍</div>
                    <p className="font-bold text-slate-400 uppercase tracking-[0.4em] text-sm">Tra cứu dữ liệu Jrai</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === TabType.LEARN && (
            <div className="max-w-5xl mx-auto">
              {!isTestingMode ? (
                <div className="animate-in fade-in duration-500">
                  <div className="flex flex-col md:flex-row justify-between items-center mb-10 p-8 bg-white rounded-3xl shadow-sm border border-slate-200">
                    <div>
                      <h2 className="font-black text-slate-900 text-2xl mb-1">Ghi nhớ từ vựng</h2>
                      <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Học nhanh 6 từ vựng mỗi ngày</p>
                    </div>
                    <button onClick={refreshQuiz} className="mt-4 md:mt-0 bg-slate-100 text-slate-600 px-8 py-4 rounded-xl font-bold text-xs uppercase hover:bg-slate-200 transition-all">Đổi bộ từ khác</button>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
                    {quizWords.map((item, i) => (
                      <div key={i} className="bg-white rounded-3xl p-8 border border-slate-100 shadow-sm flex flex-col items-center justify-center text-center min-h-[200px] hover:shadow-md transition-shadow">
                        <h3 className="text-3xl font-black text-blue-600 mb-3">{item.jrai}</h3>
                        <div className="h-1 w-8 bg-slate-100 mb-4 rounded-full"></div>
                        <p className="text-slate-500 font-bold uppercase text-sm tracking-widest">{item.viet}</p>
                      </div>
                    ))}
                  </div>

                  <div className="text-center py-10 bg-blue-50/50 rounded-3xl border border-blue-100">
                    <p className="font-bold text-blue-900 text-lg mb-6">Bạn đã học xong? Kiểm tra thử ngay.</p>
                    <button onClick={startTest} className="bg-blue-600 text-white px-12 py-5 rounded-2xl font-black text-sm uppercase tracking-widest shadow-xl shadow-blue-500/20 hover:scale-105 transition-all">Bắt đầu bài thi</button>
                  </div>
                </div>
              ) : (
                <div className="animate-in slide-in-from-right-4 duration-500">
                  <div className="flex flex-col md:flex-row justify-between items-center mb-10 p-8 bg-slate-900 rounded-3xl shadow-xl text-white">
                    <div>
                      <h2 className="font-black text-white text-2xl mb-1 italic">Đang Kiểm Tra</h2>
                      <p className="text-blue-400 text-xs font-bold uppercase tracking-widest">Nhập đáp án chính xác để hoàn thành</p>
                    </div>
                    <div className="flex gap-4 mt-6 md:mt-0 w-full md:w-auto">
                      <button onClick={checkResults} className="flex-1 bg-emerald-500 text-white px-8 py-4 rounded-xl font-bold text-xs uppercase hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20">Nộp bài</button>
                      <button onClick={refreshQuiz} className="flex-1 bg-white/10 text-white px-8 py-4 rounded-xl font-bold text-xs uppercase hover:bg-white/20 transition-all">Hủy & Học lại</button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {quizWords.map((item, i) => (
                      <div key={i} className={`bg-white rounded-3xl p-8 border-2 transition-all min-h-[250px] flex flex-col items-center justify-center relative overflow-hidden ${item.status === 'correct' ? 'border-emerald-500 shadow-emerald-500/5' : item.status === 'wrong' ? 'border-red-400 bg-red-50/20' : 'border-slate-100'}`}>
                        <div className="w-full space-y-6">
                          <div className="text-center">
                            <p className="text-blue-500 font-bold text-[10px] uppercase tracking-widest mb-2">Dịch từ sau sang {item.questionSide === 'jrai' ? 'tiếng Việt' : 'tiếng Jrai'}:</p>
                            <p className="font-black text-slate-900 text-3xl">{item.questionSide === 'jrai' ? item.jrai : item.viet}</p>
                          </div>
                          <input 
                            type="text" 
                            className={`w-full p-4 border-2 rounded-2xl text-center font-bold text-lg outline-none transition-all ${item.status === 'correct' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : item.status === 'wrong' ? 'border-red-500 bg-red-50 text-red-700' : 'border-slate-50 focus:border-blue-500 bg-slate-50/50 focus:bg-white'}`}
                            placeholder="Nhập đáp án..."
                            value={item.userInput}
                            onChange={(e) => { const n = [...quizWords]; n[i].userInput = e.target.value; n[i].status = 'none'; setQuizWords(n); }}
                          />
                          {item.status === 'wrong' && (
                            <div className="animate-in fade-in duration-300">
                               <p className="text-[10px] text-red-400 font-bold text-center uppercase mb-1">Đáp án đúng:</p>
                               <p className="text-red-700 font-black text-center">{item.questionSide === 'jrai' ? item.viet : item.jrai}</p>
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
            <div className="max-w-xl mx-auto py-10">
              <div className="bg-white p-10 md:p-14 rounded-[2.5rem] shadow-sm border border-slate-200 relative overflow-hidden">
                 <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50 rounded-bl-full -mr-16 -mt-16 opacity-50"></div>
                 <h2 className="text-2xl font-black text-slate-900 mb-10 text-center uppercase tracking-tight relative z-10">Thêm Từ Vựng Mới</h2>
                 <div className="space-y-8 relative z-10">
                   <div className="space-y-2">
                     <label className="text-xs font-bold text-slate-400 uppercase ml-2">Từ tiếng Jrai</label>
                     <input id="new-jrai" type="text" placeholder="Ví dụ: Aba" className="w-full p-5 rounded-2xl bg-slate-50 border border-slate-100 focus:ring-4 focus:ring-blue-500/10 focus:bg-white focus:border-blue-600 outline-none font-bold transition-all" />
                   </div>
                   <div className="space-y-2">
                     <label className="text-xs font-bold text-slate-400 uppercase ml-2">Nghĩa tiếng Việt</label>
                     <input id="new-viet" type="text" placeholder="Ví dụ: Con ba ba" className="w-full p-5 rounded-2xl bg-slate-50 border border-slate-100 focus:ring-4 focus:ring-blue-500/10 focus:bg-white focus:border-blue-600 outline-none font-bold transition-all" />
                   </div>
                   <button onClick={() => {
                     const j = (document.getElementById('new-jrai') as HTMLInputElement).value;
                     const v = (document.getElementById('new-viet') as HTMLInputElement).value;
                     if (j && v) { setDictionary(prev => ({...prev, [normalize(j)]: {jrai: j, viet: v}})); alert("Đã thêm từ vựng thành công!"); (document.getElementById('new-jrai') as HTMLInputElement).value = ''; (document.getElementById('new-viet') as HTMLInputElement).value = ''; }
                   }} className="w-full bg-slate-900 text-white py-5 rounded-2xl font-bold uppercase tracking-widest shadow-lg hover:bg-blue-600 transition-all active:scale-95">Lưu vào bộ nhớ</button>
                 </div>
              </div>
            </div>
          )}

          {activeTab === TabType.DATA && (
             <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8 py-10">
                <div className="bg-white p-10 rounded-[2.5rem] shadow-sm border border-slate-200 text-center flex flex-col items-center">
                  <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mb-6">
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                  </div>
                  <h3 className="font-bold text-slate-800 uppercase text-sm mb-4">Xuất Dữ Liệu Tự Thêm</h3>
                  <p className="text-xs text-slate-400 mb-8 px-4 font-medium leading-relaxed">Lưu ý: Hệ thống chỉ xuất các từ vựng do bạn tự thêm thủ công để đảm bảo tính tinh gọn của file sao lưu.</p>
                  <button onClick={handleExport} className="w-full py-5 bg-blue-600 text-white rounded-2xl font-bold uppercase text-[10px] hover:bg-blue-700 transition-all shadow-xl shadow-blue-500/20 active:scale-95">Tải xuống file JSON</button>
                </div>
                <div className="bg-slate-50 p-10 rounded-[2.5rem] border border-slate-200 text-center flex flex-col justify-center items-center">
                  <div className="w-16 h-16 bg-white text-red-500 rounded-full flex items-center justify-center mb-6 shadow-sm border border-red-50">
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                  </div>
                  <h3 className="font-bold text-slate-500 uppercase text-xs mb-4 tracking-widest">Khôi Phục Mặc Định</h3>
                  <p className="text-[10px] text-slate-400 mb-8 font-medium italic">Hành động này không thể hoàn tác.</p>
                  <button onClick={() => confirm("Xác nhận xóa toàn bộ từ đã thêm và khôi phục về từ điển mặc định?") && setDictionary(DEFAULT_DICTIONARY)} className="bg-white text-red-600 border border-red-100 py-4 px-10 rounded-2xl font-bold uppercase text-[10px] hover:bg-red-50 transition-all shadow-sm">Reset Hệ Thống</button>
                </div>
             </div>
          )}
        </main>

        <footer className="mt-20 pt-12 border-t border-slate-200">
          <div className="flex flex-col md:flex-row justify-between items-start gap-12 mb-16">
            <div className="max-w-md">
              <h4 className="text-slate-900 font-black text-xl mb-3 tracking-tight italic uppercase">Tra Cứu Từ Nhanh <span className="text-blue-600">Jrai-Việt</span></h4>
              <p className="text-slate-500 text-sm leading-relaxed mb-6 font-medium">Phiên bản học tập và cộng tác cộng đồng v3.2. Cảm ơn sự đóng góp của bạn trong việc xây dựng kho dữ liệu ngôn ngữ.</p>
              <p className="text-[10px] text-slate-300 font-bold uppercase tracking-[0.2em]">© 2025 Jrai-Viet Project.</p>
            </div>
            
            <div className="w-full md:w-auto">
              <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-6 block text-center md:text-left">Cổng thông tin & Hỗ trợ</span>
                <div className="flex flex-col sm:flex-row gap-4">
                  <a 
                    href="https://discord.gg/TpjGV3EHt" 
                    target="_blank" 
                    className="flex items-center justify-center gap-3 bg-blue-600 text-white px-8 py-4 rounded-2xl hover:bg-blue-700 transition-all active:scale-95 group shadow-lg shadow-blue-500/20"
                  >
                    <DiscordIcon />
                    <div className="text-left">
                      <p className="text-[9px] font-bold uppercase opacity-70 leading-none mb-1">Tham gia cộng đồng</p>
                      <p className="text-xs font-black uppercase tracking-wider">Discord Jrai</p>
                    </div>
                  </a>
                  <a 
                    href="https://discord.gg/2qK6P5FW" 
                    target="_blank" 
                    className="flex items-center justify-center gap-3 bg-emerald-500 text-white px-8 py-4 rounded-2xl hover:bg-emerald-600 transition-all active:scale-95 group shadow-lg shadow-emerald-500/20"
                  >
                    <DiscordIcon />
                    <div className="text-left">
                      <p className="text-[9px] font-bold uppercase opacity-70 leading-none mb-1">Gửi yêu cầu hỗ trợ</p>
                      <p className="text-xs font-black uppercase tracking-wider">Liên hệ Admin</p>
                    </div>
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
