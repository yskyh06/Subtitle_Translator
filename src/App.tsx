import { useEffect, useRef, useState } from 'react';
import init, { process_subtitle_frame, init_panic_hook } from '../packages/core-rust/pkg/core_rust';
import SettingsModal from './components/SettingsModal';
import { useVisionEngine } from './hooks/useVisionEngine';
import { useChromeAI } from './hooks/useChromeAI';

// ⭐️ 1주일 유지되는 스마트 캐싱 함수
async function fetchModelWithCache(url: string, cacheName = 'subtranslate-models-v1') {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(url);
  
  if (cachedResponse) {
    const cachedAt = cachedResponse.headers.get('x-cached-at');
    if (cachedAt) {
      const ageInMs = Date.now() - parseInt(cachedAt, 10);
      const oneWeekInMs = 7 * 24 * 60 * 60 * 1000;
      if (ageInMs < oneWeekInMs) {
        console.log(`[Cache] ⚡ ${url} 캐시에서 로드 완료`);
        return await cachedResponse.arrayBuffer();
      }
    }
  }

  console.log(`[Cache] 📥 ${url} 다운로드 중...`);
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  
  const headers = new Headers(response.headers);
  headers.set('x-cached-at', Date.now().toString());
  const responseToCache = new Response(buffer.slice(0), { headers, status: response.status, statusText: response.statusText });
  await cache.put(url, responseToCache);
  
  return buffer;
}

const globalStyles = `
  html, body, #root { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: var(--bg-base); }
  * { box-sizing: border-box; }
  .theme-dark { --bg-base: #111214; --bg-secondary: #2b2d31; --bg-tertiary: #1e1f22; --text-main: #f2f3f5; --text-muted: #b5bac1; --glass-bg: rgba(30, 31, 34, 0.6); --glass-border: rgba(255, 255, 255, 0.1); --solid-content: #1e1f22; --input-bg: rgba(0, 0, 0, 0.3); --btn-primary: #5865F2; --btn-primary-hover: #4752C4; --btn-disabled: #4f545c; }
  .theme-light { --bg-base: #f2f3f5; --bg-secondary: #e3e5e8; --bg-tertiary: #d5d7dc; --text-main: #060607; --text-muted: #4e5058; --glass-bg: rgba(255, 255, 255, 0.7); --glass-border: rgba(0, 0, 0, 0.1); --solid-content: #ffffff; --input-bg: #e3e5e8; --btn-primary: #5865F2; --btn-primary-hover: #4752C4; --btn-disabled: #c7c9ce; }
  .app-container { width: 100%; height: 100%; position: relative; background: var(--bg-base); color: var(--text-main); font-family: 'Pretendard', sans-serif; transition: background 0.4s ease, color 0.4s ease; }
  .glass-panel { background: var(--glass-bg); backdrop-filter: blur(12px) saturate(160%); border: 1px solid var(--glass-border); box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2); color: var(--text-main); }
  .glass-modal-overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px); z-index: 1000; display: flex; justify-content: center; align-items: center; }
  .fluent-btn { background: var(--bg-secondary); border: 1px solid var(--glass-border); color: var(--text-main); padding: 10px 20px; border-radius: 6px; cursor: pointer; font-weight: 600; transition: all 0.2s ease; display: flex; align-items: center; gap: 8px; }
  .fluent-btn:not(:disabled):hover { filter: brightness(1.1); }
  .fluent-btn:disabled { background: var(--btn-disabled); cursor: not-allowed; opacity: 0.6; border: none; }
  .fluent-btn.primary { background: var(--btn-primary); border-color: var(--btn-primary); color: white; }
  .fluent-btn.primary:not(:disabled):hover { background: var(--btn-primary-hover); }
  .fluent-btn.danger { background: #da373c; border-color: #da373c; color: white; }
  .fluent-btn.active-toggle { background: #23a559; border-color: #23a559; color: white; }
  .log-terminal { background: #000; color: #0f0; font-family: monospace; font-size: 0.9rem; padding: 15px; border-radius: 8px; height: 200px; overflow-y: auto; border: 1px solid var(--glass-border); display: flex; flex-direction: column; gap: 4px; text-align: left; }
  .log-info { color: #cbd5e0; } .log-success { color: #48bb78; } .log-error { color: #fc8181; }
  .setup-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; width: 100%; max-width: 900px; margin: 0 auto; }
  .fluent-spinner { width: 24px; height: 24px; border: 3px solid var(--glass-border); border-top: 3px solid #3182ce; border-radius: 50%; animation: fluent-spin 1s linear infinite; }
  @keyframes fluent-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
`;

type AppStep = 'landing' | 'eula' | 'setup' | 'capturing';
type LogEntry = { id: string; text: string; type: 'info' | 'success' | 'error' };

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const [appStep, setAppStep] = useState<AppStep>('landing');
  const [eulaAgreed, setEulaAgreed] = useState(false);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [isStreamSelected, setIsStreamSelected] = useState(false);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  
  const [isDragMode, setIsDragMode] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  
  // 환경 설정 상태
  const [theme, setTheme] = useState("dark"); 
  const [langName, setLangName] = useState({ src: "일본어", tgt: "한국어" });
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState("general");

  const [scanInterval, setScanInterval] = useState(500); 
  const [maxLines, setMaxLines] = useState(2); 
  const [subPosition, setSubPosition] = useState("bottom"); 
  const [subColor, setSubColor] = useState("#ffffff");
  const [subSize, setSubSize] = useState(32);
  const [subFont, setSubFont] = useState("sans-serif");
  const [showDebugBox, setShowDebugBox] = useState(false);

  // 렌더링에 영향 없는 Ref (타이머용)
  const scanIntervalRef = useRef(500);
  const isDraggingRef = useRef(false);
  const startPosRef = useRef({ x: 0, y: 0 });
  const cropRectRef = useRef({ x: 0, y: 0.8, w: 1, h: 0.2 });
  const isModelLoadedRef = useRef(false);
  const isPausedRef = useRef(false);

  const addLog = (text: string, type: 'info' | 'success' | 'error' = 'info') => {
    setLogs(prev => [...prev, { id: crypto.randomUUID(), text, type }].slice(-100));
  };

  // ⭐️ 1. 비전 엔진 훅 (눈)
  const { recognizedText, setRecognizedText, detectedBoxesRef, initEngine, processOCR } = useVisionEngine({ maxLines });
  
  // ⭐️ 2. 언어 엔진 훅 (뇌)
  const { translatedText, isTranslating, setTranslatedText, initTranslator, processTranslation } = useChromeAI({ langName, addLog });

  // ⭐️ 3. 두 엔진의 연결고리 (글자가 인식되면 자동으로 번역 호출)
  useEffect(() => {
    if (recognizedText.trim()) {
      processTranslation(recognizedText);
    } else {
      setTranslatedText("");
    }
  }, [recognizedText, processTranslation, setTranslatedText]);

  useEffect(() => {
    const sysLang = navigator.language.toLowerCase();
    if (sysLang.startsWith('ko')) { setLangName({ src: "일본어", tgt: "한국어" }); } 
    else if (sysLang.startsWith('en')) { setLangName({ src: "Japanese", tgt: "English" }); } 
    else { setLangName({ src: "Japanese", tgt: navigator.language }); }
  }, []);

  useEffect(() => { isModelLoadedRef.current = isModelLoaded; }, [isModelLoaded]);
  useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);
  useEffect(() => { scanIntervalRef.current = scanInterval; }, [scanInterval]);

  // ⭐️ 4. 비전 엔진 및 기초 모델 로딩 (페이지 접속 시)
  useEffect(() => {
    if (appStep !== 'setup') return;
    
    let isMounted = true;
    const runSetup = async () => {
      try {
        addLog("▶ 시스템 초기화 및 모델 일괄 로드 시작...", "info"); 
        setLoadingProgress(10);
        
        const res = await fetch('/models/jp_dict.txt', { cache: 'no-store' });
        const text = await res.text();
        const charList = ["blank", ...text.split('\n').map(l => l.trim()), " "];
        setLoadingProgress(30);

        await init(); init_panic_hook();
        setLoadingProgress(50);

        addLog("▶ 인식/탐지(Vision) 모델 로드 중...", "info");
        const recBuffer = await fetchModelWithCache('/models/japan_rec_fixed.onnx', 'subtranslate-rec');
        const detBuffer = await fetchModelWithCache('/models/det_fixed.onnx', 'subtranslate-det');
        
        // 훅 내부에 있는 초기화 함수 호출!
        await initEngine(detBuffer, recBuffer, charList);
        
        if (isMounted) {
          addLog("▶ ✅ 비전 엔진 로드 완료! 화면을 공유해 주세요.", "success");
          setLoadingProgress(100);
          setIsModelLoaded(true);
        }
      } catch (e: any) {
        if (isMounted) addLog(`❌ 에러 발생: ${e.message}`, "error");
      }
    };
    
    runSetup();
    return () => { isMounted = false; };
  }, [appStep, initEngine]);

  const handleSelectStream = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 60 } }, audio: false });
      setMediaStream(stream);
      setIsStreamSelected(true);
      addLog(`▶ ✅ 화면 연결 완료`, "success");
    } catch (err) { 
      addLog("❌ 화면 공유가 취소되었거나 실패했습니다.", "error");
    }
  };

  // ⭐️ 5. 사지방 에러 해결: 번역 엔진 로드를 사용자가 버튼을 눌렀을 때 실행!
  const startFinalCapture = async () => {
    await initTranslator(); // <- 핵심 포인트!
    setAppStep('capturing');
    setIsDragMode(true);
    setIsPaused(true); 
  };

  const stopCapture = () => {
    if (mediaStream) mediaStream.getTracks().forEach(track => track.stop());
    setMediaStream(null);
    setAppStep('landing');
    setIsStreamSelected(false); setIsModelLoaded(false); setLoadingProgress(0);
    setLogs([]); setRecognizedText(""); setTranslatedText(""); 
    setEulaAgreed(false); setShowSettings(false);
  };

  useEffect(() => {
    if (appStep === 'capturing' && videoRef.current && mediaStream) {
      videoRef.current.srcObject = mediaStream;
      videoRef.current.onloadedmetadata = () => { videoRef.current?.play().catch(e => console.error(e)); };
    }
  }, [appStep, mediaStream]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDragMode || appStep !== 'capturing') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = canvasRef.current!.getBoundingClientRect();
    isDraggingRef.current = true;
    startPosRef.current = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDraggingRef.current || !isDragMode || appStep !== 'capturing') return;
    const r = canvasRef.current!.getBoundingClientRect();
    let cx = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    let cy = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    cropRectRef.current = { x: Math.min(startPosRef.current.x, cx), y: Math.min(startPosRef.current.y, cy), w: Math.abs(cx - startPosRef.current.x), h: Math.abs(cy - startPosRef.current.y) };
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isDraggingRef.current) { 
      isDraggingRef.current = false; 
      e.currentTarget.releasePointerCapture(e.pointerId);
    } 
  };

  useEffect(() => {
    if (appStep !== 'capturing') return;
    let anim: number, timer: number;
    
    const render = () => {
      const v = videoRef.current, c = canvasRef.current;
      if (v && c && v.readyState === 4) {
        if (c.width !== v.videoWidth) { c.width = v.videoWidth; c.height = v.videoHeight; }
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, c.width, c.height);
          if (isDragMode) {
            const { x, y, w, h } = cropRectRef.current;
            const cx = Math.floor(x * c.width), cy = Math.floor(y * c.height), cw = Math.floor(w * c.width), ch = Math.floor(h * c.height);
            ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0,0,c.width,c.height);
            ctx.clearRect(cx, cy, cw, ch);
            ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.strokeRect(cx, cy, cw, ch);
          } else if (!isPausedRef.current && showDebugBox && detectedBoxesRef.current.length > 0) {
            const { x, y } = cropRectRef.current;
            const cx = Math.floor(x * c.width), cy = Math.floor(y * c.height);
            ctx.strokeStyle = '#00ff00'; ctx.lineWidth = 2;
            detectedBoxesRef.current.forEach(box => { ctx.strokeRect(cx + box.x, cy + box.y, box.w, box.h); });
          }
        }
      }
      anim = requestAnimationFrame(render);
    };
    
    const loop = () => {
      const scheduleNext = () => { timer = window.setTimeout(loop, scanIntervalRef.current); };
      if (!isModelLoadedRef.current || isDraggingRef.current || isDragMode || isPausedRef.current || videoRef.current?.readyState !== 4) {
        scheduleNext(); return;
      }
      const v = videoRef.current;
      const { x, y, w, h } = cropRectRef.current;
      const off = new OffscreenCanvas(w * v.videoWidth, h * v.videoHeight);
      const ctx = off.getContext('2d', { willReadFrequently: true });
      ctx?.drawImage(v, x * v.videoWidth, y * v.videoHeight, w * v.videoWidth, h * v.videoHeight, 0, 0, off.width, off.height);
      const img = ctx?.getImageData(0, 0, off.width, off.height);
      
      // 분리된 OCR 엔진 사용!
      if (img && process_subtitle_frame(img.width, img.height, new Uint8Array(img.data.buffer))) processOCR(img);
      scheduleNext();
    };
    
    render(); timer = window.setTimeout(loop, scanIntervalRef.current);
    return () => { cancelAnimationFrame(anim); clearTimeout(timer); };
  }, [appStep, isDragMode, showDebugBox, processOCR, detectedBoxesRef]);

  return (
    <>
      <style>{globalStyles}</style>
      <div className={`app-container ${theme === 'dark' ? 'theme-dark' : 'theme-light'}`}>
        
        {appStep === 'landing' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', textAlign: 'center' }}>
            <h1 style={{ fontSize: '4rem', fon햐tWeight: '900', margin: '0 0 10px 0', letterSpacing: '-2px' }}>SubTranslate</h1>
            <p style={{ fontSize: '1.2rem', color: 'var(--text-muted)', marginBottom: '40px' }}>공유된 화면을 분석하여 즉시 자막을 추출합니다.</p>
            <button onClick={() => setAppStep('eula')} className="fluent-btn primary" style={{ padding: '16px 40px', fontSize: '1.2rem', borderRadius: '8px' }}>시작하기</button>
          </div>
        )}

        {appStep === 'eula' && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <div className="glass-panel" style={{ width: '600px', padding: '30px', borderRadius: '12px' }}>
              <h2 style={{ marginTop: 0 }}>최종 사용자 라이선스 계약 (EULA)</h2>
              <div style={{ background: 'var(--bg-secondary)', padding: '15px', borderRadius: '8px', height: '200px', overflowY: 'auto', fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '20px' }}>
                <p>본 소프트웨어는 로컬에서만 작동합니다.</p>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', marginBottom: '20px', fontWeight: 'bold' }}>
                <input type="checkbox" checked={eulaAgreed} onChange={e => setEulaAgreed(e.target.checked)} style={{ width: '18px', height: '18px', cursor: 'pointer' }} />
                위의 내용에 동의합니다.
              </label>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button onClick={() => setAppStep('landing')} className="fluent-btn">취소</button>
                <button onClick={() => setAppStep('setup')} disabled={!eulaAgreed} className="fluent-btn primary">동의 및 계속</button>
              </div>
            </div>
          </div>
        )}

        {appStep === 'setup' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '40px', overflowY: 'auto' }}>
            <h1 style={{ textAlign: 'center', marginBottom: '40px' }}>초기 설정 및 엔진 다운로드</h1>
            <div className="setup-grid">
              <div className="glass-panel" style={{ padding: '25px', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>📥 AI 시스템 부팅 로그 {(!isModelLoaded) && <div className="fluent-spinner" style={{ width: '18px', height: '18px' }}></div>}</h3>
                <div style={{ width: '100%', background: 'var(--bg-secondary)', height: '12px', borderRadius: '6px', overflow: 'hidden' }}><div style={{ width: `${loadingProgress}%`, background: 'var(--btn-primary)', height: '100%', transition: 'width 0.4s ease' }}></div></div>
                <div className="log-terminal" style={{ flex: 1 }}>{logs.map(log => (<div key={log.id} className={`log-${log.type}`}>{log.text}</div>))}</div>
              </div>
              <div className="glass-panel" style={{ padding: '25px', borderRadius: '12px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <h3 style={{ margin: '0 0 20px 0' }}>⚙️ 구동 환경 세팅</h3>
                  <div style={{ marginBottom: '20px' }}><button onClick={handleSelectStream} className={`fluent-btn ${isStreamSelected ? '' : 'primary'}`} style={{ width: '100%', justifyContent: 'center' }}>{isStreamSelected ? '🔄 화면 다시 선택' : '🖥 화면 공유'}</button></div>
                </div>
                {/* ⭐️ User Gesture를 받기 위해 번역 엔진 로드를 이 버튼 안으로 옮겼습니다! */}
                <button onClick={startFinalCapture} disabled={!isModelLoaded || !isStreamSelected} className="fluent-btn primary" style={{ padding: '15px', fontSize: '1.2rem', marginTop: '30px', justifyContent: 'center' }}>
                  {(!isModelLoaded || !isStreamSelected) ? '설정을 완료해 주세요' : '🚀 자막 번역 시작하기'}
                </button>
              </div>
            </div>
          </div>
        )}

        {appStep === 'capturing' && (
          <>
            <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }} playsInline muted />
            <canvas ref={canvasRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: isDragMode ? 'auto' : 'none', cursor: isDragMode ? 'crosshair' : 'default' , zIndex: 10, touchAction: 'none' }} />
            
            {!isDragMode && (
              <div style={{ position: 'absolute', bottom: subPosition === 'bottom' ? '60px' : 'auto', top: subPosition === 'top' ? '90px' : 'auto', left: '50%', transform: 'translateX(-50%)', textAlign: 'center', zIndex: 9999, width: '90%', pointerEvents: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: `${Math.max(14, subSize * 0.5)}px`, color: '#aaaaaa', fontFamily: subFont, background: 'rgba(0,0,0,0.6)', padding: '4px 12px', borderRadius: '6px' }}>{recognizedText || '인식 대기 중...'}</span>
                <span style={{ fontSize: `${subSize}px`, color: subColor, fontFamily: subFont, fontWeight: 'bold', background: 'rgba(0,0,0,0.7)', padding: '6px 16px', borderRadius: '8px' }}>{isTranslating ? '⏳ 번역 중...' : (translatedText || '화면을 분석하고 있습니다...')}</span>
              </div>
            )}  

            <div className="glass-panel" style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: '8px', padding: '8px 12px', borderRadius: '12px', alignItems: 'center', zIndex: 30 }}>
              <button onClick={stopCapture} className="fluent-btn danger">⏹ 종료</button>
              <button onClick={() => setIsPaused(!isPaused)} className={`fluent-btn ${isPaused ? 'primary' : ''}`}>{isPaused ? '▶ 재개' : '⏸ 정지'}</button>
              <button onClick={() => { const next = !isDragMode; setIsDragMode(next); setIsPaused(next); if(next){ setRecognizedText(""); setTranslatedText(""); } }} className={`fluent-btn ${isDragMode ? 'active-toggle' : ''}`}>{isDragMode ? '✔ 영역 확정' : '✂ 크롭 재지정'}</button>
              <button onClick={() => setShowSettings(true)} className="fluent-btn">⚙️ 설정</button>
            </div>
          </>
        )}
        
        <SettingsModal show={showSettings} onClose={() => setShowSettings(false)} theme={theme} setTheme={setTheme} scanInterval={scanInterval} setScanInterval={setScanInterval} subPosition={subPosition} setSubPosition={setSubPosition} subSize={subSize} setSubSize={setSubSize} subColor={subColor} setSubColor={setSubColor} subFont={subFont} setSubFont={setSubFont} maxLines={maxLines} setMaxLines={setMaxLines} showDebugBox={showDebugBox} setShowDebugBox={setShowDebugBox} activeTab={activeTab} setActiveTab={setActiveTab} />
      </div>
    </>
  );
}

export default App;