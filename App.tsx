
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Dictionary, TabType, WordEntry } from './types';
import { DEFAULT_DICTIONARY, DiscordIcon, SpeakerIcon } from './constants';
import { explainWord, getSpeech } from './services/gemini';

// Helper giải mã Base64 sang Uint8Array (thủ công theo guideline)
function decodeBase64ToBytes(base64: string) {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Helper giải mã PCM sang AudioBuffer
async function decodePcmToBuffer(data: Uint8Array, ctx: AudioContext): Promise<AudioBuffer> {
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

const WordCard: React.FC<{ entry: WordEntry; onExplain?: () => void }> = ({ entry, onExplain }) => {
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
      if (!base64) throw new Error("No audio data");

      const bytes = decodeBase64ToBytes(base64);
      const buffer = await decodePcmToBuffer(bytes, ctx);
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
    <div className="bg-white rounded-xl p-4 md:p-5 mb-3 shadow-sm border-l-4 border-orange-600 hover:shadow-md transition-all">
      <div className="flex flex-col sm:flex-row justify-between items-start gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-lg md:text-xl font-bold text-orange-900">{entry.jrai}</h3>
            <button 
              onClick={() => handlePlay(entry.jrai, false)}
              className={`p-1.5 rounded-full hover:bg-orange-100 transition-colors ${playing ? 'text-orange-300' : 'text-orange-600'}`}
              title="Nghe tiếng Jrai"
            >
              <SpeakerIcon />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <p className="text-gray-600 font-medium text-sm md:text-base">{entry.viet}</p>
            <button 
              onClick={() => handlePlay(entry.viet, true)}
              className={`p-1.5 rounded-full hover:bg-orange-50 transition-colors ${playing ? 'text-gray-300' : 'text-gray-400'}`}
              title="Nghe tiếng Việt"
            >
              <SpeakerIcon />
            </button>
          </div>
        </div>
        {onExplain && (
          <button 
            onClick={onExplain}
            className="w-full sm:w-auto text-[10px] md:text-xs bg-orange-100 text-orange-700 px-3 py-1.5 rounded-lg font-bold hover:bg-orange-200 transition-colors uppercase tracking-wider"
          >
            💡 Giải thích AI
          </button>
        )}
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const [dictionary, setDictionary] = useState<Dictionary>(DEFAULT_DICTIONARY);
  const [activeTab, setActiveTab] = useState<TabType>(TabType.SEARCH);
  const [searchQuery, setSearchQuery] = useState('');
  const [quizWords, setQuizWords] = useState<QuizItem[]>([]);
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const [loadingAi, setLoadingAi] = useState(false);
  const [securityKey, setSecurityKey] = useState('');

  const normalize = (str: string) => {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  };

  useEffect(() => {
    const saved = localStorage.getItem('jrai_dict_v1.5');
    if (saved) {
      try { setDictionary(JSON.parse(saved)); } catch (e) { console.error("Data error"); }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('jrai_dict_v1.5', JSON.stringify(dictionary));
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

  const startTesting = () => {
    setQuizWords(prev => prev.map(item => ({
      ...item,
      isTesting: true,
      questionSide: Math.random() > 0.5 ? 'jrai' : 'viet',
      status: 'none',
      userInput: ''
    })));
  };

  const handleCheckAll = () => {
    setQuizWords(prev => prev.map(item => {
      if (!item.isTesting) return item;
      const target = item.questionSide === 'jrai' ? item.viet : item.jrai;
      const isCorrect = normalize(item.userInput) === normalize(target);
      return { ...item, status: isCorrect ? 'correct' : 'wrong' };
    }));
  };

  // Fix: Explicitly type filteredResults and cast Object.values to WordEntry[] to resolve 'unknown' property errors.
  const filteredResults: WordEntry[] = searchQuery.trim() 
    ? (Object.values(dictionary) as WordEntry[]).filter((w: WordEntry) => normalize(w.jrai) === normalize(searchQuery) || normalize(w.viet) === normalize(searchQuery))
    : [];

  const handleExplain = async (word: WordEntry) => {
    setLoadingAi(true);
    setAiExplanation(null);
    const text = await explainWord(word.jrai, word.viet);
    setAiExplanation(`**${word.jrai}**: ${text}`);
    setLoadingAi(false);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-4 md:py-8 pb-32">
      {/* Header Compact for Mobile */}
      <header className="bg-gradient-to-br from-orange-800 to-orange-600 text-white p-6 md:p-10 rounded-2xl md:rounded-3xl shadow-xl text-center mb-6">
        <h1 className="text-2xl md:text-4xl font-black tracking-tight uppercase">Jrai - Việt</h1>
        <p className="text-xs md:text-sm mt-1 text-orange-100 opacity-90 font-medium">Tra từ nhanh & Học tập hiệu quả</p>
      </header>

      {/* Stats Section */}
      <div className="flex items-center justify-center gap-4 mb-6 md:mb-10">
        <div className="bg-white border border-orange-100 px-6 py-2 rounded-full shadow-sm flex items-center gap-3">
          <span className="text-2xl font-black text-orange-600 tracking-tighter">{Object.keys(dictionary).length}</span>
          <span className="text-[10px] md:text-xs font-bold text-gray-500 uppercase tracking-widest">Từ vựng</span>
        </div>
      </div>

      {/* Responsive Tabs */}
      <nav className="flex bg-white p-1 rounded-xl md:rounded-2xl shadow-sm mb-6 md:mb-10 overflow-x-auto no-scrollbar border border-gray-100">
        {(Object.values(TabType) as TabType[]).map(tab => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setAiExplanation(null); }}
            className={`flex-1 min-w-[80px] py-2.5 md:py-4 px-2 rounded-lg md:rounded-xl font-black transition-all text-[10px] md:text-xs uppercase tracking-tighter md:tracking-widest ${
              activeTab === tab ? 'bg-orange-600 text-white shadow-lg scale-[1.02]' : 'text-gray-400 hover:bg-orange-50'
            }`}
          >
            {tab}
          </button>
        ))}
      </nav>

      {/* Main Content Area - Wide for Desktop */}
      <main className="min-h-[400px]">
        {activeTab === TabType.SEARCH && (
          <div className="animate-in fade-in duration-500 grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="lg:col-span-8">
              <div className="sticky top-4 z-10 bg-orange-50/80 backdrop-blur-md p-2 rounded-2xl mb-6 border border-orange-100">
                <input 
                  type="text" 
                  placeholder="Nhập từ Jrai hoặc tiếng Việt..."
                  className="w-full p-4 md:p-5 rounded-xl border-none focus:ring-2 focus:ring-orange-500 outline-none transition-all shadow-inner bg-white font-bold text-gray-800"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <div className="space-y-4">
                {searchQuery.trim() && filteredResults.length === 0 ? (
                  <div className="bg-white p-10 rounded-2xl border-2 border-dashed border-orange-200 text-center">
                    <p className="text-orange-800 font-bold mb-2">Không tìm thấy từ này</p>
                    <p className="text-xs text-gray-400">Hãy kiểm tra lại chính tả hoặc thêm từ mới ở tab Quản Lý.</p>
                  </div>
                ) : (
                  filteredResults.map((w, i) => <WordCard key={i} entry={w} onExplain={() => handleExplain(w)} />)
                )}
                {!searchQuery.trim() && (
                  <div className="text-center py-20 text-gray-300">
                    <div className="text-5xl mb-4">🔍</div>
                    <p className="italic font-medium text-sm">Bắt đầu tra cứu bằng cách nhập từ vào ô phía trên.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Side Explanations for Desktop */}
            <div className="lg:col-span-4 space-y-6">
              {(aiExplanation || loadingAi) && (
                <div className="bg-orange-600 text-white p-6 rounded-3xl shadow-xl animate-in slide-in-from-right-4 duration-300">
                  <h3 className="font-black text-xs uppercase tracking-widest mb-4 flex items-center gap-2">
                    <span className="bg-white/20 p-1.5 rounded-lg text-lg">✨</span> Trí tuệ nhân tạo
                  </h3>
                  {loadingAi ? (
                    <div className="flex flex-col items-center py-10 gap-3">
                      <div className="w-8 h-8 border-4 border-white/30 border-t-white rounded-full animate-spin"></div>
                      <p className="text-[10px] font-bold uppercase animate-pulse">Đang phân tích dữ liệu...</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm leading-relaxed font-medium whitespace-pre-wrap">{aiExplanation}</p>
                      <button onClick={() => setAiExplanation(null)} className="w-full py-2 bg-black/10 hover:bg-black/20 rounded-xl text-[10px] font-black uppercase transition-colors">Đóng giải thích</button>
                    </div>
                  )}
                </div>
              )}
              <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
                <h4 className="font-black text-[10px] text-gray-400 uppercase tracking-widest mb-4">Mẹo tra cứu</h4>
                <ul className="text-xs text-gray-500 space-y-3 font-medium">
                  <li className="flex gap-2"><span>•</span> Nhập từ tiếng Việt hoặc tiếng Jrai hệ thống đều hiểu.</li>
                  <li className="flex gap-2"><span>•</span> Nhấn vào icon loa để nghe phát âm bản địa chuẩn xác.</li>
                  <li className="flex gap-2"><span>•</span> Dùng AI để hiểu sâu hơn về ngữ cảnh sử dụng từ.</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {activeTab === TabType.LEARN && (
          <div className="animate-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4 bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
              <h2 className="text-sm md:text-lg font-black text-gray-800 uppercase tracking-tight">Học & Kiểm tra ngẫu nhiên</h2>
              <div className="flex gap-2 w-full md:w-auto">
                <button onClick={startTesting} className="flex-1 md:flex-none bg-orange-100 text-orange-800 px-4 py-2.5 rounded-xl font-black text-[10px] uppercase hover:bg-orange-200 transition-all">Bắt đầu thi</button>
                <button onClick={handleCheckAll} className="flex-1 md:flex-none bg-green-600 text-white px-4 py-2.5 rounded-xl font-black text-[10px] uppercase hover:bg-green-700 transition-all shadow-md">Nộp bài</button>
                <button onClick={refreshQuiz} className="flex-1 md:flex-none bg-gray-800 text-white px-4 py-2.5 rounded-xl font-black text-[10px] uppercase hover:bg-black transition-all">Đổi từ mới</button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {quizWords.map((item, i) => (
                <div key={i} className="bg-white rounded-2xl p-6 shadow-sm border-b-4 border-orange-400 hover:-translate-y-1 transition-all min-h-[160px] flex flex-col justify-center">
                  {!item.isTesting ? (
                    <div className="text-center">
                      <span className="text-[9px] font-black text-gray-300 uppercase tracking-[0.2em] mb-2 block">Thẻ số {i+1}</span>
                      <h3 className="text-2xl font-black text-orange-900">{item.jrai}</h3>
                      <div className="w-8 h-1 bg-orange-100 mx-auto my-3"></div>
                      <p className="text-gray-600 font-bold text-sm uppercase">{item.viet}</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex justify-between items-center border-b border-gray-50 pb-2">
                        <span className="text-[9px] font-black text-orange-300 uppercase">Câu hỏi {i+1}</span>
                        <span className="text-[9px] font-bold text-gray-400 italic">Dịch sang {item.questionSide === 'jrai' ? 'Tiếng Việt' : 'Tiếng Jrai'}</span>
                      </div>
                      <div className="text-xl font-black text-center text-orange-900 uppercase">
                        {item.questionSide === 'jrai' ? item.jrai : item.viet}
                      </div>
                      <input 
                        type="text"
                        className={`w-full p-3 border-2 rounded-xl outline-none transition-all font-bold text-sm text-center ${
                          item.status === 'correct' ? 'border-green-500 bg-green-50 text-green-700' : 
                          item.status === 'wrong' ? 'border-red-500 bg-red-50 text-red-700' : 'border-gray-100 focus:border-orange-500 bg-gray-50'
                        }`}
                        placeholder="..."
                        value={item.userInput}
                        onChange={(e) => {
                          const next = [...quizWords];
                          next[i].userInput = e.target.value;
                          next[i].status = 'none';
                          setQuizWords(next);
                        }}
                      />
                      {item.status === 'wrong' && <p className="text-[9px] text-red-400 font-bold text-center italic uppercase">Đúng là: {item.questionSide === 'jrai' ? item.viet : item.jrai}</p>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab Manage and Data kept consistent but with wider layout */}
        {activeTab === TabType.MANAGE && (
          <div className="max-w-xl mx-auto animate-in fade-in py-10">
            <div className="bg-white p-8 md:p-12 rounded-[2rem] shadow-sm border border-gray-100">
               <h2 className="text-xl font-black text-gray-800 mb-8 uppercase text-center">Bổ sung kho từ vựng</h2>
               <div className="space-y-6">
                 <div>
                   <label className="block text-[10px] font-black text-gray-400 uppercase mb-2 ml-2">Từ tiếng Jrai</label>
                   <input id="new-jrai" type="text" className="w-full p-4 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-orange-500 focus:bg-white outline-none transition-all font-bold" />
                 </div>
                 <div>
                   <label className="block text-[10px] font-black text-gray-400 uppercase mb-2 ml-2">Nghĩa tiếng Việt</label>
                   <input id="new-viet" type="text" className="w-full p-4 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-orange-500 focus:bg-white outline-none transition-all font-bold" />
                 </div>
                 <button 
                   onClick={() => {
                     const j = (document.getElementById('new-jrai') as HTMLInputElement).value;
                     const v = (document.getElementById('new-viet') as HTMLInputElement).value;
                     if (j && v) {
                       setDictionary(prev => ({...prev, [normalize(j)]: {jrai: j, viet: v}}));
                       (document.getElementById('new-jrai') as HTMLInputElement).value = '';
                       (document.getElementById('new-viet') as HTMLInputElement).value = '';
                       alert("Đã thêm thành công!");
                     }
                   }}
                   className="w-full bg-orange-600 text-white py-5 rounded-2xl font-black hover:bg-orange-700 shadow-xl transition-all uppercase tracking-widest text-sm"
                 >
                   Lưu vào từ điển
                 </button>
               </div>
            </div>
          </div>
        )}

        {activeTab === TabType.DATA && (
          <div className="animate-in fade-in py-10 space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
                <h3 className="font-black text-orange-800 uppercase text-sm mb-6">Xuất dữ liệu hệ thống</h3>
                <div className="mb-6">
                  <label className="block text-[10px] font-black text-gray-400 uppercase mb-2">Mã bảo mật Admin</label>
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
                    link.download = "jrai_dict_backup.json";
                    link.click();
                  }}
                  className="w-full py-4 bg-orange-100 text-orange-800 rounded-2xl font-black hover:bg-orange-200 transition-colors uppercase text-[10px] tracking-widest"
                >
                  Tải file JSON
                </button>
              </div>

              <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100 flex flex-col justify-between">
                <div>
                  <h3 className="font-black text-orange-800 uppercase text-sm mb-4">Đồng bộ từ File</h3>
                  <p className="text-[10px] text-gray-400 font-medium mb-6">Sử dụng file JSON lưu trữ để khôi phục nhanh.</p>
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
                          alert("Đã đồng bộ!");
                        } catch (err) { alert("File không hợp lệ."); }
                      };
                      reader.readAsText(file);
                    }
                  }}
                />
              </div>
            </div>

            <div className="bg-red-50 p-8 rounded-3xl border-2 border-red-100 text-center">
              <h3 className="font-black text-red-800 uppercase text-xs mb-2">Xóa toàn bộ & Khôi phục gốc</h3>
              <p className="text-[10px] text-red-600/70 mb-6 font-bold uppercase tracking-wider">Mọi thay đổi cá nhân sẽ bị mất vĩnh viễn.</p>
              <button 
                onClick={() => { if (confirm("Xác nhận khôi phục cài đặt gốc?")) setDictionary(DEFAULT_DICTIONARY); }}
                className="bg-red-600 text-white px-10 py-4 rounded-2xl font-black hover:bg-red-700 shadow-lg active:scale-95 transition-all text-[10px] uppercase"
              >
                Reset Toàn Bộ
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Modern Floating Footer */}
      <footer className="fixed bottom-4 left-4 right-4 md:bottom-6 md:left-1/2 md:-translate-x-1/2 md:max-w-4xl bg-white/80 backdrop-blur-xl border border-white/20 p-4 rounded-2xl md:rounded-[2rem] shadow-2xl z-50">
        <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
          <p className="text-[9px] text-gray-400 font-black uppercase tracking-tighter">© 2025 Jrai Dictionary - Di sản Tây Nguyên</p>
          <div className="flex gap-2 w-full sm:w-auto">
            <a href="https://discord.gg/TpjGV3EHt" target="_blank" rel="noopener noreferrer" className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-[#5865F2] text-white px-5 py-2.5 rounded-xl text-[9px] font-black uppercase hover:scale-105 active:scale-95 transition-transform"><DiscordIcon /> Discord</a>
            <a href="https://discord.gg/2qK6P5FW" target="_blank" rel="noopener noreferrer" className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-gray-900 text-white px-5 py-2.5 rounded-xl text-[9px] font-black uppercase hover:scale-105 active:scale-95 transition-transform"><DiscordIcon /> Admin</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
