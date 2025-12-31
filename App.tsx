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
    <div className="bg-white rounded-2xl p-4 md:p-6 mb-4 shadow-sm border border-orange-100 hover:shadow-md transition-all flex justify-between items-center group">
      <div className="flex-1">
        <div className="flex items-center gap-3 mb-1">
          <h3 className="text-xl md:text-2xl font-black text-orange-900">{entry.jrai}</h3>
          <button onClick={() => handlePlay(entry.jrai, false)} className={`p-2 rounded-full hover:bg-orange-100 transition-colors ${playing ? 'text-orange-300' : 'text-orange-600'}`}>
            <SpeakerIcon />
          </button>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-gray-500 font-bold text-sm md:text-lg">{entry.viet}</p>
          <button onClick={() => handlePlay(entry.viet, true)} className={`p-1.5 rounded-full hover:bg-orange-50 transition-colors ${playing ? 'text-gray-300' : 'text-gray-400'}`}>
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
  const [securityKey, setSecurityKey] = useState('');

  const normalize = (str: string) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

  useEffect(() => {
    const saved = localStorage.getItem('jrai_dict_v1.7');
    if (saved) { try { setDictionary(JSON.parse(saved)); } catch (e) {} }
  }, []);

  useEffect(() => { localStorage.setItem('jrai_dict_v1.7', JSON.stringify(dictionary)); }, [dictionary]);

  const refreshQuiz = useCallback(() => {
    const keys = Object.keys(dictionary);
    const shuffled = [...keys].sort(() => 0.5 - Math.random());
    setQuizWords(shuffled.slice(0, 6).map(k => ({ ...dictionary[k], questionSide: 'jrai', userInput: '', status: 'none', isTesting: false })));
  }, [dictionary]);

  useEffect(() => { if (activeTab === TabType.LEARN) refreshQuiz(); }, [activeTab, refreshQuiz]);

  const filteredResults = searchQuery.trim() 
    ? (Object.values(dictionary) as WordEntry[]).filter(w => normalize(w.jrai).includes(normalize(searchQuery)) || normalize(w.viet).includes(normalize(searchQuery)))
    : [];

  return (
    <div className="min-h-screen pb-40">
      <div className="max-w-6xl mx-auto px-4 pt-6 md:pt-12">
        {/* Header - Optimized for all screens */}
        <header className="bg-gradient-to-br from-orange-600 to-orange-400 text-white p-8 md:p-16 rounded-[2.5rem] shadow-2xl text-center mb-10 relative overflow-hidden">
          <div className="relative z-10">
            <h1 className="text-4xl md:text-7xl font-black tracking-tighter uppercase mb-3">JRAI - VIỆT</h1>
            <p className="text-xs md:text-base font-black uppercase tracking-[0.3em] opacity-80">Từ điển học tập thông minh v1.7</p>
          </div>
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-20 -mt-20 blur-3xl"></div>
        </header>

        {/* Tab Navigation */}
        <nav className="flex bg-white/80 backdrop-blur-md p-1.5 rounded-2xl shadow-xl mb-10 border border-white sticky top-4 z-50 overflow-x-auto no-scrollbar">
          {(Object.values(TabType) as TabType[]).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`flex-1 min-w-[100px] py-3 md:py-5 rounded-xl font-black text-[10px] md:text-xs uppercase tracking-widest transition-all ${activeTab === tab ? 'bg-orange-600 text-white shadow-lg scale-[1.02]' : 'text-gray-400 hover:text-orange-500'}`}>
              {tab}
            </button>
          ))}
        </nav>

        <main className="animate-in fade-in slide-in-from-bottom-4 duration-700">
          {activeTab === TabType.SEARCH && (
            <div className="max-w-4xl mx-auto">
              <div className="relative mb-12">
                <input 
                  type="text" 
                  placeholder="Tra cứu từ vựng..." 
                  className="w-full p-6 md:p-8 rounded-[2rem] border-none shadow-2xl bg-white font-black text-xl md:text-3xl focus:ring-4 focus:ring-orange-500/20 outline-none transition-all placeholder:text-gray-200"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {searchQuery.trim() ? (
                  filteredResults.length > 0 ? filteredResults.map((w, i) => <WordCard key={i} entry={w} />) : <div className="col-span-full py-20 text-center font-black text-gray-300 uppercase">Không tìm thấy từ này</div>
                ) : (
                  <div className="col-span-full py-32 text-center">
                    <span className="text-8xl block mb-6 opacity-20">🔎</span>
                    <p className="font-black text-gray-300 uppercase tracking-widest">Nhập từ để tìm kiếm</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === TabType.LEARN && (
            <div className="max-w-5xl mx-auto">
              <div className="flex flex-col md:flex-row justify-between items-center mb-10 gap-4 bg-white p-6 rounded-3xl shadow-sm border border-orange-50">
                <h2 className="font-black uppercase text-gray-800 tracking-tight text-lg">Luyện tập ghi nhớ</h2>
                <div className="flex gap-2 w-full md:w-auto">
                  <button onClick={() => setQuizWords(prev => prev.map(it => ({...it, isTesting: true, questionSide: Math.random() > 0.5 ? 'jrai' : 'viet', status: 'none', userInput: ''})))} className="flex-1 bg-orange-600 text-white px-6 py-3 rounded-xl font-black text-[10px] uppercase shadow-lg">Kiểm tra</button>
                  <button onClick={refreshQuiz} className="flex-1 bg-gray-100 text-gray-500 px-6 py-3 rounded-xl font-black text-[10px] uppercase">Làm mới</button>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {quizWords.map((item, i) => (
                  <div key={i} className="bg-white rounded-[2.5rem] p-8 shadow-xl border-b-8 border-orange-100 flex flex-col items-center justify-center min-h-[250px]">
                    {!item.isTesting ? (
                      <div className="text-center">
                        <h3 className="text-3xl font-black text-orange-900 mb-2">{item.jrai}</h3>
                        <p className="text-gray-400 font-bold uppercase">{item.viet}</p>
                      </div>
                    ) : (
                      <div className="w-full space-y-6">
                        <p className="text-center font-black text-orange-900 text-2xl uppercase">{item.questionSide === 'jrai' ? item.jrai : item.viet}</p>
                        <input 
                          type="text" 
                          className={`w-full p-4 border-2 rounded-2xl text-center font-black outline-none transition-all ${item.status === 'correct' ? 'border-green-500 bg-green-50' : item.status === 'wrong' ? 'border-red-500 bg-red-50' : 'border-gray-50 focus:border-orange-500'}`}
                          placeholder="Dịch nghĩa..."
                          value={item.userInput}
                          onChange={(e) => { const n = [...quizWords]; n[i].userInput = e.target.value; n[i].status = 'none'; setQuizWords(n); }}
                          onBlur={() => {
                            const target = item.questionSide === 'jrai' ? item.viet : item.jrai;
                            const n = [...quizWords];
                            n[i].status = normalize(item.userInput) === normalize(target) ? 'correct' : 'wrong';
                            setQuizWords(n);
                          }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === TabType.MANAGE && (
            <div className="max-w-xl mx-auto py-10">
              <div className="bg-white p-10 md:p-14 rounded-[3rem] shadow-2xl border border-orange-50">
                 <h2 className="text-2xl font-black text-gray-800 mb-12 uppercase text-center tracking-tighter">Bổ sung từ điển</h2>
                 <div className="space-y-8">
                   <input id="new-jrai" type="text" placeholder="Từ tiếng Jrai" className="w-full p-5 rounded-2xl bg-gray-50 border-none ring-2 ring-transparent focus:ring-orange-500 outline-none font-black text-lg" />
                   <input id="new-viet" type="text" placeholder="Nghĩa tiếng Việt" className="w-full p-5 rounded-2xl bg-gray-50 border-none ring-2 ring-transparent focus:ring-orange-500 outline-none font-black text-lg" />
                   <button onClick={() => {
                     const j = (document.getElementById('new-jrai') as HTMLInputElement).value;
                     const v = (document.getElementById('new-viet') as HTMLInputElement).value;
                     if (j && v) { setDictionary(prev => ({...prev, [normalize(j)]: {jrai: j, viet: v}})); alert("Đã lưu!"); }
                   }} className="w-full bg-orange-600 text-white py-6 rounded-2xl font-black uppercase tracking-widest shadow-xl">Thêm từ mới</button>
                 </div>
              </div>
            </div>
          )}

          {activeTab === TabType.DATA && (
             <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8 py-10">
                <div className="bg-white p-10 rounded-[2.5rem] shadow-xl border border-gray-100 text-center">
                  <h3 className="font-black text-orange-800 uppercase text-sm mb-6">Xuất file dự phòng</h3>
                  <input type="password" placeholder="Mã Admin (JRAI2025)" className="w-full p-4 mb-4 border-2 border-gray-50 rounded-2xl font-black outline-none focus:border-orange-500 text-center" value={securityKey} onChange={e => setSecurityKey(e.target.value)} />
                  <button onClick={() => securityKey === 'JRAI2025' ? window.open("data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(dictionary))) : alert("Sai mã!")} className="w-full py-4 bg-orange-100 text-orange-800 rounded-2xl font-black uppercase text-[10px]">Tải file JSON</button>
                </div>
                <div className="bg-red-50 p-10 rounded-[2.5rem] border-2 border-red-100 text-center flex flex-col justify-center">
                  <h3 className="font-black text-red-800 uppercase text-xs mb-4">Xóa dữ liệu</h3>
                  <button onClick={() => confirm("Xác nhận Reset?") && setDictionary(DEFAULT_DICTIONARY)} className="bg-red-600 text-white py-4 rounded-2xl font-black uppercase text-[10px] shadow-lg">Reset Toàn Bộ</button>
                </div>
             </div>
          )}
        </main>

        <footer className="fixed bottom-6 left-6 right-6 md:bottom-10 md:left-1/2 md:-translate-x-1/2 md:max-w-3xl bg-white/60 backdrop-blur-2xl border border-white/40 p-5 rounded-[2rem] shadow-2xl z-50">
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
            <p className="text-[10px] text-gray-400 font-black uppercase tracking-tighter">© 2025 Jrai Dictionary - Version 1.7</p>
            <div className="flex gap-2">
              <a href="https://discord.gg/TpjGV3EHt" target="_blank" className="bg-[#5865F2] text-white p-3 rounded-xl hover:scale-110 transition-transform"><DiscordIcon /></a>
              <a href="https://discord.gg/2qK6P5FW" target="_blank" className="bg-gray-900 text-white p-3 rounded-xl hover:scale-110 transition-transform"><DiscordIcon /></a>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default App;
