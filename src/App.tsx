import { useEffect, useRef, useState } from 'react';
import init, { process_subtitle_frame, init_panic_hook } from '../packages/core-rust/pkg/core_rust';
import * as ort from 'onnxruntime-web';

// ⭐️ 1주일 유지되는 스마트 캐싱 함수 (7일 지나면 자동 파기 후 재다운로드)
async function fetchModelWithCache(url: string, cacheName = 'subtranslate-models-v1') {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(url);
  
  if (cachedResponse) {
    const cachedAt = cachedResponse.headers.get('x-cached-at');
    if (cachedAt) {
      const ageInMs = Date.now() - parseInt(cachedAt, 10);
      const oneWeekInMs = 7 * 24 * 60 * 60 * 1000;
      if (ageInMs < oneWeekInMs) {
        console.log(`[Cache] ⚡ ${url} 캐시에서 로드 완료 (수명: ${(ageInMs / 86400000).toFixed(1)}일 됨)`);
        return await cachedResponse.arrayBuffer();
      } else {
        console.log(`[Cache] 🗑️ ${url} 캐시 만료 (1주일 경과). 새로 다운로드합니다.`);
      }
    }
  }

  console.log(`[Cache] 📥 ${url} 네트워크에서 다운로드 중...`);
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  
  const headers = new Headers(response.headers);
  headers.set('x-cached-at', Date.now().toString());
  
  const responseToCache = new Response(buffer.slice(0), { 
    headers, status: response.status, statusText: response.statusText 
  });
  await cache.put(url, responseToCache);
  
  return buffer;
}

const globalStyles = `
  html, body, #root { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: var(--bg-base); }
  * { box-sizing: border-box; }
  
  .theme-dark {
    --bg-base: #111214; --bg-secondary: #2b2d31; --bg-tertiary: #1e1f22;
    --text-main: #f2f3f5; --text-muted: #b5bac1;
    --glass-bg: rgba(30, 31, 34, 0.6); --glass-border: rgba(255, 255, 255, 0.1);
    --solid-content: #1e1f22; --input-bg: rgba(0, 0, 0, 0.3);
    --btn-primary: #5865F2; --btn-primary-hover: #4752C4; --btn-disabled: #4f545c;
  }
  .theme-light {
    --bg-base: #f2f3f5; --bg-secondary: #e3e5e8; --bg-tertiary: #d5d7dc;
    --text-main: #060607; --text-muted: #4e5058;
    --glass-bg: rgba(255, 255, 255, 0.7); --glass-border: rgba(0, 0, 0, 0.1);
    --solid-content: #ffffff; --input-bg: #e3e5e8;
    --btn-primary: #5865F2; --btn-primary-hover: #4752C4; --btn-disabled: #c7c9ce;
  }

  .app-container {
    width: 100%; height: 100%; position: relative;
    background: var(--bg-base); color: var(--text-main);
    font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    transition: background 0.4s ease, color 0.4s ease;
  }

  .glass-panel {
    background: var(--glass-bg);
    backdrop-filter: blur(12px) saturate(160%); -webkit-backdrop-filter: blur(12px) saturate(160%);
    border: 1px solid var(--glass-border);
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
    color: var(--text-main);
  }
  
  .glass-modal-overlay {
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px);
    z-index: 1000; display: flex; justify-content: center; align-items: center;
  }

  .fluent-btn {
    background: var(--bg-secondary); border: 1px solid var(--glass-border);
    color: var(--text-main); padding: 10px 20px; border-radius: 6px;
    cursor: pointer; font-weight: 600; transition: all 0.2s ease;
    display: flex; align-items: center; gap: 8px;
  }
  .fluent-btn:not(:disabled):hover { filter: brightness(1.1); }
  .fluent-btn:disabled { background: var(--btn-disabled); cursor: not-allowed; opacity: 0.6; border: none; }
  .fluent-btn.primary { background: var(--btn-primary); border-color: var(--btn-primary); color: white; }
  .fluent-btn.primary:not(:disabled):hover { background: var(--btn-primary-hover); }
  .fluent-btn.danger { background: #da373c; border-color: #da373c; color: white; }
  .fluent-btn.active-toggle { background: #23a559; border-color: #23a559; color: white; }

  .log-terminal { background: #000000; color: #00ff00; font-family: monospace; font-size: 0.9rem; padding: 15px; border-radius: 8px; height: 200px; overflow-y: auto; border: 1px solid var(--glass-border); display: flex; flex-direction: column; gap: 4px; text-align: left; }
  .log-info { color: #cbd5e0; } .log-success { color: #48bb78; } .log-error { color: #fc8181; }

  .setup-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; width: 100%; max-width: 900px; margin: 0 auto; }
  .tab-menu { display: flex; flex-direction: column; gap: 5px; width: 140px; border-right: 1px solid var(--glass-border); padding-right: 15px; }
  .tab-btn { background: transparent; border: none; color: var(--text-muted); text-align: left; padding: 10px 15px; border-radius: 6px; cursor: pointer; font-weight: bold; transition: 0.2s; }
  .tab-btn:hover { background: var(--bg-secondary); color: var(--text-main); }
  .tab-btn.active { background: var(--bg-secondary); color: var(--text-main); border-left: 3px solid var(--btn-primary); }
  .num-input { width: 60px; padding: 4px 8px; border-radius: 4px; border: 1px solid var(--glass-border); background: var(--input-bg); color: var(--text-main); text-align: right; font-family: inherit; outline: none; }
  
  .fluent-spinner { width: 24px; height: 24px; border: 3px solid var(--glass-border); border-top: 3px solid #3182ce; border-radius: 50%; animation: fluent-spin 1s linear infinite; }
  @keyframes fluent-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
`;

type AppStep = 'landing' | 'eula' | 'setup' | 'capturing';
type LogEntry = { id: string; text: string; type: 'info' | 'success' | 'error' };

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const isTranslatingRef = useRef(false);
  const pendingTextRef = useRef<string | null>(null);

  const [appStep, setAppStep] = useState<AppStep>('landing');
  const [eulaAgreed, setEulaAgreed] = useState(false);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [isStreamSelected, setIsStreamSelected] = useState(false);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  
  const charListRef = useRef<string[]>([]);
  const [recognizedText, setRecognizedText] = useState("");
  
  const [debouncedText, setDebouncedText] = useState("");
  const [translatedText, setTranslatedText] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  
  const [isDragMode, setIsDragMode] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  
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
  
  // ⭐️ 디버그 박스 토글용 상태 추가
  const [showDebugBox, setShowDebugBox] = useState(false);

  const scanIntervalRef = useRef(500);
  const maxLinesRef = useRef(2);
  const isDraggingRef = useRef(false);
  const startPosRef = useRef({ x: 0, y: 0 });
  const cropRectRef = useRef({ x: 0, y: 0.8, w: 1, h: 0.2 });

  const detSessionRef = useRef<ort.InferenceSession | null>(null);
  const ortSessionRef = useRef<ort.InferenceSession | null>(null);
  const isInferencingRef = useRef(false);
  const lastTextRef = useRef("");
  const detectedBoxesRef = useRef<{x: number, y: number, w: number, h: number}[]>([]);
  
  const isModelLoadedRef = useRef(false);
  const isPausedRef = useRef(false);

  const [translator, setTranslator] = useState<any>(null);
  const [llmLoadingProgress, setLlmLoadingProgress] = useState(0);
  
  const addLog = (text: string, type: 'info' | 'success' | 'error' = 'info') => {
    setLogs(prev => {
      const newLogs = [...prev, { id: crypto.randomUUID(), text, type }];
      return newLogs.slice(-100); 
    });
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      if (recognizedText.trim()) {
        setDebouncedText(recognizedText);
      }
    }, 200); 
    return () => clearTimeout(timer);
  }, [recognizedText]);

  // ⭐️ 고유명사 패치: Gemini Nano가 번역과 음차를 동시에 수행!
  useEffect(() => {
    if (!translator || !debouncedText) return;
    
    pendingTextRef.current = debouncedText;

    const processQueue = async () => {
      if (isTranslatingRef.current || !pendingTextRef.current) return;

      isTranslatingRef.current = true;
      setIsTranslating(true);

      const rawText = pendingTextRef.current;
      pendingTextRef.current = null; 

      try {
        let finalTranslation = "";

        // 1단계: 똑똑한 Gemini Nano에게 오타 교정 + 고유명사 음차 + 번역을 한 번에 지시
        if ('ai' in window && 'languageModel' in (window as any).ai) {
          try {
            const nanoSession = await (window as any).ai.languageModel.create({
              systemPrompt: `너는 ${langName.src}를 ${langName.tgt}로 번역하는 전문 번역가야. 추출된 문장의 오타를 문맥에 맞게 교정하고 번역해 줘. 
가장 중요한 규칙: 지명, 인명, 역 이름 등 '고유명사'는 절대 뜻으로 번역하지 말고, 반드시 현지 발음대로 한국어로 음차(예: 東京 -> 도쿄, 上石見 -> 카미이와미)해서 작성해 줘. 어떠한 부연 설명이나 인사말 없이 최종 번역된 결과 문장만 정확히 출력해.`
            });
            finalTranslation = await nanoSession.prompt(rawText);
            nanoSession.destroy();
          } catch (nanoError) {
            console.warn("Gemini Nano 번역 실패, 기본 번역 API로 대체합니다:", nanoError);
          }
        }

        // 2단계: Nano가 지원되지 않거나 실패했을 경우 기본 API(Translator)로 백업 직행
        if (!finalTranslation) {
          finalTranslation = await translator.translate(rawText);
        }

        setTranslatedText(finalTranslation);

      } catch (e: any) {
        if (!e.message?.includes('channel closed')) {
          addLog("❌ 번역 연산 중 오류 발생", "error");
          console.error(e);
        }
      } finally {
        isTranslatingRef.current = false;
        setIsTranslating(false);

        if (pendingTextRef.current) {
          processQueue();
        }
      }
    };

    processQueue();
  }, [debouncedText, translator, langName.src]);

  useEffect(() => {
    const sysLang = navigator.language.toLowerCase();
    if (sysLang.startsWith('ko')) { setLangName({ src: "일본어", tgt: "한국어" }); } 
    else if (sysLang.startsWith('en')) { setLangName({ src: "Japanese", tgt: "English" }); } 
    else { setLangName({ src: "Japanese", tgt: navigator.language }); }
  }, []);

  useEffect(() => { isModelLoadedRef.current = isModelLoaded; }, [isModelLoaded]);
  useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);
  useEffect(() => { scanIntervalRef.current = scanInterval; maxLinesRef.current = maxLines; }, [scanInterval, maxLines]);

  // ⭐️ 통합 로딩 로직 (캐싱, 비전 엔진, 번역 API 원클릭 일괄 처리)
  useEffect(() => {
    if (appStep !== 'setup') return;
    
    let isMounted = true;
    const runSetup = async () => {
      try {
        addLog("▶ 시스템 초기화 및 모델 일괄 로드 시작...", "info"); 
        setLoadingProgress(10);
        
        // --- 1. 사전 파일 로드 ---
        const res = await fetch('/models/jp_dict.txt', { cache: 'no-store' });
        const text = await res.text();
        const lines = text.split('\n').map(l => l.trim());
        charListRef.current = ["blank", ...lines, " "];
        setLoadingProgress(20);

        // --- 2. 코어 엔진 부팅 ---
        await init(); init_panic_hook();
        setLoadingProgress(30);

        ort.env.wasm.wasmPaths = '/node_modules/onnxruntime-web/dist/';
        ort.env.wasm.numThreads = 4; 
        ort.env.wasm.proxy = false;

        // --- 3. 비전 모델 (스마트 캐싱 적용) ---
        addLog("▶ 1단계: 인식/탐지(Vision) 모델 로드 중 (스마트 캐싱 적용)...", "info");
        const recBuffer = await fetchModelWithCache('/models/japan_rec_fixed.onnx', 'subtranslate-rec');
        ortSessionRef.current = await ort.InferenceSession.create(recBuffer, { executionProviders: ['webgpu'] });
        setLoadingProgress(50);

        const detBuffer = await fetchModelWithCache('/models/det_fixed.onnx', 'subtranslate-det');
        detSessionRef.current = await ort.InferenceSession.create(detBuffer, { executionProviders: ['webgpu'] });
        setLoadingProgress(70);
        
        // 예열
        const dummyDet = new ort.Tensor('float32', new Float32Array(1 * 3 * 640 * 640), [1, 3, 640, 640]);
        await detSessionRef.current.run({ [detSessionRef.current.inputNames[0]]: dummyDet });
        const dummyRec = new ort.Tensor('float32', new Float32Array(1 * 3 * 48 * 320), [1, 3, 48, 320]);
        await ortSessionRef.current.run({ [ortSessionRef.current.inputNames[0]]: dummyRec });
        setLoadingProgress(85);

        // --- 4. 크롬 내장 AI (Translator) 연결 ---
        addLog("▶ 2단계: Chrome 내장 언어 AI(Translator) 연결 중...", "info");
        const pair = { sourceLanguage: 'ja', targetLanguage: 'ko' };
        let translatorInstance = null;

        if ('Translator' in window) {
          translatorInstance = await (window as any).Translator.create(pair);
        } else if ('ai' in window && 'translator' in (window as any).ai) {
          translatorInstance = await (window as any).ai.translator.create(pair);
        } else if ('translation' in window) {
          const canTranslate = await (window as any).translation.canTranslate(pair);
          if (canTranslate !== 'no') {
            translatorInstance = await (window as any).translation.createTranslator(pair);
          }
        }

        if (!translatorInstance) {
          throw new Error("Chrome 번역 API를 찾을 수 없습니다.");
        }
        
        setTranslator(translatorInstance);
        
        if (isMounted) {
          addLog("▶ ✅ 모든 AI 엔진 통합 로드 완료! 준비되었습니다.", "success");
          setLoadingProgress(100);
          setIsModelLoaded(true);
        }
      } catch (e: any) {
        if (isMounted) addLog(`❌ 에러 발생: ${e.message}`, "error");
      }
    };
    
    runSetup();
    return () => { isMounted = false; };
  }, [appStep]);

  const handleSelectStream = async () => {
    try {
      const options: any = { 
        video: { 
          // displaySurface 속성을 지워 해상도 제한을 해제했습니다.
          width: { ideal: 3840, max: 4096 }, // 4K 화질 타겟팅
          height: { ideal: 2160, max: 2160 },
          frameRate: { ideal: 60, max: 60 },
          resizeMode: "none" // 브라우저의 임의 해상도 압축 방지
        }, 
        audio: false 
      };
      
      if ('CaptureController' in window) {
        const controller = new (window as any).CaptureController();
        if (controller.setFocusBehavior) controller.setFocusBehavior("no-focus-change");
        options.controller = controller;
      }
      const stream = await navigator.mediaDevices.getDisplayMedia(options);
      setMediaStream(stream);
      setIsStreamSelected(true);
      addLog(`▶ ✅ 화면 연결 완료 (최고 화질 모드)`, "success");
    } catch (err) { 
      console.error(err);
      addLog("❌ 화면 공유가 취소되었거나 실패했습니다.", "error");
    }
  };

  const startFinalCapture = () => {
    setAppStep('capturing');
    setIsDragMode(true);
    setIsPaused(true); 
  };

  const stopCapture = () => {
    if (mediaStream) mediaStream.getTracks().forEach(track => track.stop());
    setMediaStream(null);
    setAppStep('landing');
    setIsStreamSelected(false); setIsModelLoaded(false); setLoadingProgress(0);
    setLogs([]); setRecognizedText(""); setTranslatedText(""); lastTextRef.current = ""; 
    setEulaAgreed(false); setShowSettings(false);
  };

  useEffect(() => {
    if (appStep === 'capturing' && videoRef.current && mediaStream) {
      videoRef.current.srcObject = mediaStream;
      videoRef.current.onloadedmetadata = () => { videoRef.current?.play().catch(e => console.error(e)); };
    }
  }, [appStep, mediaStream]);

  const preprocessDet = async (img: ImageData) => {
    const targetW = 640;
    const targetH = 640;
    const canvas = new OffscreenCanvas(targetW, targetH);
    const ctx = canvas.getContext('2d')!;
    
    const scale = Math.min(targetW / img.width, targetH / img.height);
    const newW = img.width * scale;
    const newH = img.height * scale;
    const offsetX = (targetW - newW) / 2;
    const offsetY = (targetH - newH) / 2;

    const btm = await createImageBitmap(img);
    ctx.fillStyle = 'black'; 
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.drawImage(btm, 0, 0, img.width, img.height, offsetX, offsetY, newW, newH);
    btm.close();
    
    const data = ctx.getImageData(0, 0, targetW, targetH).data;
    const floatData = new Float32Array(3 * targetW * targetH);
    
    for (let i = 0; i < targetW * targetH; i++) {
      floatData[i] = (data[i * 4] / 255.0 - 0.485) / 0.229; 
      floatData[i + targetW*targetH] = (data[i * 4 + 1] / 255.0 - 0.456) / 0.224; 
      floatData[i + 2*targetW*targetH] = (data[i * 4 + 2] / 255.0 - 0.406) / 0.225; 
    }
    
    return new ort.Tensor('float32', floatData, [1, 3, targetH, targetW]);
  };

  const postProcessDet = (heatmap: Float32Array, targetW: number, targetH: number, originalW: number, originalH: number) => {
    const threshold = 0.3; 
    const rows = [];
    let inText = false;
    let startY = 0;

    for (let y = 0; y < targetH; y++) {
      let hasText = false;
      for (let x = 0; x < targetW; x++) {
        if (heatmap[y * targetW + x] > threshold) { hasText = true; break; }
      }
      if (hasText && !inText) { inText = true; startY = y; }
      else if (!hasText && inText) { 
        inText = false; 
        if (y - startY > 5) rows.push({ startY, endY: y }); 
      }
    }
    if (inText && targetH - startY > 5) rows.push({ startY, endY: targetH });

    const boxes = [];
    const scale = Math.min(targetW / originalW, targetH / originalH);
    const offsetX = (targetW - originalW * scale) / 2;
    const offsetY = (targetH - originalH * scale) / 2;

    for (const r of rows) {
      let minX = targetW, maxX = 0;
      for (let y = r.startY; y < r.endY; y++) {
        for (let x = 0; x < targetW; x++) {
          if (heatmap[y * targetW + x] > threshold) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
          }
        }
      }
      if (minX <= maxX) {
        const padX = 10, padY = 8; 
        
        let origMinX = (minX - offsetX) / scale;
        let origMaxX = (maxX - offsetX) / scale;
        let origStartY = (r.startY - offsetY) / scale;
        let origEndY = (r.endY - offsetY) / scale;

        let bx = Math.max(0, Math.floor(origMinX) - padX);
        let by = Math.max(0, Math.floor(origStartY) - padY);
        let bw = Math.min(originalW - bx, Math.floor(origMaxX - origMinX) + padX * 2);
        let bh = Math.min(originalH - by, Math.floor(origEndY - origStartY) + padY * 2);
        
        if (bw > 0 && bh > 0) boxes.push({ x: bx, y: by, w: bw, h: bh });
      }
    }
    return boxes;
  };

  const processOCR = async (img: ImageData) => {
    if (isInferencingRef.current || !detSessionRef.current || !ortSessionRef.current) return;
    isInferencingRef.current = true;
    
    try {
      await new Promise(resolve => setTimeout(resolve, 0)); 

      const detInput = await preprocessDet(img);
      const detResults = await detSessionRef.current.run({ [detSessionRef.current.inputNames[0]]: detInput });
      const heatmap = detResults[Object.keys(detResults)[0]].data as Float32Array;
      
      const boxes = postProcessDet(heatmap, 640, 640, img.width, img.height);
      detectedBoxesRef.current = boxes; 

      if (boxes.length === 0) {
        if (lastTextRef.current !== "") {
          lastTextRef.current = "";
          setRecognizedText("");
          setTranslatedText("");
        }
        return;
      }

      let res = "";
      const btm = await createImageBitmap(img);

      for (let k = 0; k < Math.min(boxes.length, maxLinesRef.current); k++) {
        const box = boxes[k];
        if (box.w <= 0 || box.h <= 0) continue;

        const lineOff = new OffscreenCanvas(box.w, box.h);
        const lineCtx = lineOff.getContext('2d')!;
        lineCtx.filter = 'grayscale(100%) contrast(300%)'; 
        lineCtx.drawImage(btm, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
        const sliceImg = lineCtx.getImageData(0, 0, box.w, box.h);

        const targetH = 48;
        let expectedW = Math.floor(sliceImg.width * (targetH / sliceImg.height));
        if (expectedW > 640) expectedW = 640; 
        const targetW = Math.max(32, Math.ceil(expectedW / 32) * 32);
        
        const recOff = new OffscreenCanvas(targetW, targetH);
        const recCtx = recOff.getContext('2d')!;
        const sliceBtm = await createImageBitmap(sliceImg);
        recCtx.fillStyle = 'black'; recCtx.fillRect(0, 0, targetW, targetH);
        recCtx.drawImage(sliceBtm, 0, 0, sliceImg.width, sliceImg.height, 0, 0, expectedW, targetH);
        sliceBtm.close();
        
        const pxl = recCtx.getImageData(0, 0, targetW, targetH).data;
        const input = new Float32Array(3 * targetH * targetW);
        for (let i = 0; i < targetW * targetH; i++) {
          const v = pxl[i * 4] / 127.5 - 1.0;
          input[i] = v; input[i + targetW*targetH] = v; input[i + 2*targetW*targetH] = v;
        }
        
        const results = await ortSessionRef.current.run({ [ortSessionRef.current.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, targetH, targetW]) });
        const out = results[Object.keys(results)[0]];
        const [seq, dictSize] = out.dims.length === 3 ? [out.dims[1], out.dims[2]] : [out.dims[0], out.dims[1]];
        let txt = "", last = -1;
        
        for (let i = 0; i < seq; i++) {
          let mIdx = 0, mVal = out.data[i * dictSize] as number;
          for (let j = 1; j < dictSize; j++) {
            const v = out.data[i * dictSize + j] as number;
            if (v > mVal) { mVal = v; mIdx = j; }
          }
          if (mIdx > 0 && mIdx !== last) { 
            if (charListRef.current[mIdx]) txt += charListRef.current[mIdx]; 
          }
          last = mIdx;
        }
        res += txt + "\n";
      }
      btm.close();
      
      const final = res.trim();
      
      if (final !== lastTextRef.current) {
        lastTextRef.current = final;
        setRecognizedText(final);
      }

    } catch (e) {
      console.error("OCR Pipeline Error:", e);
    } finally { 
      isInferencingRef.current = false; 
    }
  };

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
    let cx = (e.clientX - r.left) / r.width;
    let cy = (e.clientY - r.top) / r.height;
    cx = Math.max(0, Math.min(1, cx));
    cy = Math.max(0, Math.min(1, cy));
    cropRectRef.current = { 
      x: Math.min(startPosRef.current.x, cx), y: Math.min(startPosRef.current.y, cy), 
      w: Math.abs(cx - startPosRef.current.x), h: Math.abs(cy - startPosRef.current.y) 
    };
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
            const len = Math.min(20, cw/4, ch/4);
            ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(cx, cy + len); ctx.lineTo(cx, cy); ctx.lineTo(cx + len, cy);
            ctx.moveTo(cx + cw - len, cy); ctx.lineTo(cx + cw, cy); ctx.lineTo(cx + cw, cy + len);
            ctx.moveTo(cx + cw, cy + ch - len); ctx.lineTo(cx + cw, cy + ch); ctx.lineTo(cx + cw - len, cy + ch);
            ctx.moveTo(cx, cy + ch - len); ctx.lineTo(cx, cy + ch); ctx.lineTo(cx + len, cy + ch);
            ctx.stroke();
          } 
          else if (!isPausedRef.current) {
            // ⭐️ 고급 탭에서 체크했을 때만 초록색 박스 렌더링
            if (showDebugBox && detectedBoxesRef.current.length > 0) {
              const { x, y } = cropRectRef.current;
              const cx = Math.floor(x * c.width);
              const cy = Math.floor(y * c.height);
              
              ctx.strokeStyle = '#00ff00'; 
              ctx.lineWidth = 2;
              detectedBoxesRef.current.forEach(box => {
                ctx.strokeRect(cx + box.x, cy + box.y, box.w, box.h);
              });
            }
          }
        }
      }
      anim = requestAnimationFrame(render);
    };
    
    const loop = () => {
      const scheduleNext = () => { timer = window.setTimeout(loop, scanIntervalRef.current); };
      if (!isModelLoadedRef.current || isInferencingRef.current || isDraggingRef.current || isDragMode || isPausedRef.current || videoRef.current?.readyState !== 4) {
        scheduleNext(); return;
      }
      const v = videoRef.current;
      const { x, y, w, h } = cropRectRef.current;
      const off = new OffscreenCanvas(w * v.videoWidth, h * v.videoHeight);
      const ctx = off.getContext('2d', { willReadFrequently: true });
      ctx?.drawImage(v, x * v.videoWidth, y * v.videoHeight, w * v.videoWidth, h * v.videoHeight, 0, 0, off.width, off.height);
      const img = ctx?.getImageData(0, 0, off.width, off.height);
      if (img && process_subtitle_frame(img.width, img.height, new Uint8Array(img.data.buffer))) processOCR(img);
      scheduleNext();
    };
    
    render(); timer = window.setTimeout(loop, scanIntervalRef.current);
    return () => { cancelAnimationFrame(anim); clearTimeout(timer); };
  }, [appStep, isDragMode, showDebugBox]);

  return (
    <>
      <style>{globalStyles}</style>
      <div className={`app-container ${theme === 'dark' ? 'theme-dark' : 'theme-light'}`}>
        
        {appStep === 'landing' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', textAlign: 'center' }}>
            <h1 style={{ fontSize: '4rem', fontWeight: '900', margin: '0 0 10px 0', letterSpacing: '-2px' }}>SubTranslate</h1>
            <p style={{ fontSize: '1.2rem', color: 'var(--text-muted)', marginBottom: '40px' }}>공유된 화면을 분석하여 즉시 자막을 추출합니다.</p>
            <button onClick={() => setAppStep('eula')} className="fluent-btn primary" style={{ padding: '16px 40px', fontSize: '1.2rem', borderRadius: '8px' }}>
              시작하기
            </button>
          </div>
        )}

        {appStep === 'eula' && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <div className="glass-panel" style={{ width: '600px', padding: '30px', borderRadius: '12px' }}>
              <h2 style={{ marginTop: 0 }}>최종 사용자 라이선스 계약 (EULA)</h2>
              <div style={{ background: 'var(--bg-secondary)', padding: '15px', borderRadius: '8px', height: '200px', overflowY: 'auto', fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '20px' }}>
                <p>본 소프트웨어(SubTranslate)를 사용함으로써 귀하는 다음 약관에 동의하게 됩니다.</p>
                <p>1. <b>개인정보 보호:</b> 본 소프트웨어는 사용자의 화면을 캡처하여 로컬(브라우저 내부)에서만 AI 연산을 수행합니다. 영상 데이터는 외부 서버로 전송되지 않습니다.</p>
                <p>2. <b>책임의 한계:</b> 제공되는 OCR 및 번역 결과의 정확성을 보장하지 않으며, 이로 인해 발생하는 모든 결과에 대한 책임은 사용자에게 있습니다.</p>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', marginBottom: '20px', fontWeight: 'bold' }}>
                <input type="checkbox" checked={eulaAgreed} onChange={e => setEulaAgreed(e.target.checked)} style={{ width: '18px', height: '18px', cursor: 'pointer' }} />
                위의 사용권 계약 및 개인정보 처리방침에 동의합니다.
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
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
                  📥 AI 시스템 부팅 로그
                  {(!isModelLoaded || (llmLoadingProgress > 0 && llmLoadingProgress < 100)) && <div className="fluent-spinner" style={{ width: '18px', height: '18px', borderWidth: '2px' }}></div>}
                </h3>
                
                <div style={{ width: '100%', background: 'var(--bg-secondary)', height: '12px', borderRadius: '6px', overflow: 'hidden' }}>
                  <div style={{ width: `${loadingProgress}%`, background: 'var(--btn-primary)', height: '100%', transition: 'width 0.4s ease' }}></div>
                </div>
                <div style={{ textAlign: 'right', fontSize: '0.9rem', fontWeight: 'bold' }}>전체 준비 진행률: {loadingProgress}%</div>

                <div className="log-terminal" style={{ flex: 1 }}>
                  {logs.map(log => (
                    <div key={log.id} className={`log-${log.type}`}>{log.text}</div>
                  ))}
                </div>
              </div>

              <div className="glass-panel" style={{ padding: '25px', borderRadius: '12px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <h3 style={{ margin: '0 0 20px 0' }}>⚙️ 구동 환경 세팅</h3>
                  
                  <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '8px' }}>1. 번역 언어</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'var(--bg-secondary)', padding: '12px', borderRadius: '8px' }}>
                      <select disabled style={{ flex: 1, padding: '8px', background: 'var(--bg-base)', color: 'var(--text-muted)', border: '1px solid var(--glass-border)', borderRadius: '4px' }}><option>일본어 (Japanese)</option></select>
                      <span style={{ fontWeight: 'bold' }}>➔</span>
                      <select disabled style={{ flex: 1, padding: '8px', background: 'var(--bg-base)', color: 'var(--text-muted)', border: '1px solid var(--glass-border)', borderRadius: '4px' }}><option>한국어 (Korean)</option></select>
                    </div>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '8px' }}>2. 분석할 화면(게임/영상) 선택</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px', background: 'var(--bg-secondary)', padding: '15px', borderRadius: '8px' }}>
                      <button onClick={handleSelectStream} className={`fluent-btn ${isStreamSelected ? '' : 'primary'}`} style={{ flex: 1, justifyContent: 'center' }}>
                        {isStreamSelected ? '🔄 다시 선택하기' : '🖥 화면 공유'}
                      </button>
                      <div style={{ flex: 1, textAlign: 'center', fontWeight: 'bold', color: isStreamSelected ? '#23a559' : 'var(--text-muted)' }}>
                        {isStreamSelected ? '✅ 화면 연결됨' : '❌ 대기 중'}
                      </div>
                    </div>
                  </div>
                </div>

                <button 
                  onClick={startFinalCapture} 
                  disabled={!isModelLoaded || !isStreamSelected || !translator} 
                  className="fluent-btn primary" 
                  style={{ padding: '15px', fontSize: '1.2rem', marginTop: '30px', justifyContent: 'center' }}
                >
                  {(!isModelLoaded || !isStreamSelected || !translator) ? '설정을 모두 완료해 주세요' : '🚀 자막 번역 시작하기'}
                </button>
              </div>
            </div>
          </div>
        )}

        {appStep === 'capturing' && (
          <>
            <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }} playsInline muted />
            
            <canvas 
              ref={canvasRef} 
              onPointerDown={onPointerDown} 
              onPointerMove={onPointerMove} 
              onPointerUp={onPointerUp} 
              onPointerCancel={onPointerUp} 
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: isDragMode ? 'auto' : 'none', cursor: isDragMode ? 'crosshair' : 'default', zIndex: 10, touchAction: 'none' }} 
            />
            
            {isDragMode && (
              <div className="glass-panel" style={{ position: 'absolute', top: '90px', left: '50%', transform: 'translateX(-50%)', padding: '12px 24px', borderRadius: '8px', fontWeight: 'bold', zIndex: 20 }}>
                자막이 표시되는 영역을 타이트하게 지정해 주세요
              </div>
            )}

            {!isDragMode && (
              <div style={{ 
                position: 'absolute', 
                bottom: subPosition === 'bottom' ? '60px' : 'auto', 
                top: subPosition === 'top' ? '90px' : 'auto', 
                left: '50%', transform: 'translateX(-50%)', textAlign: 'center', zIndex: 9999, width: '90%', pointerEvents: 'none',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px'
              }}>
                <span style={{ 
                  whiteSpace: 'pre-wrap', lineHeight: '1.4', 
                  fontSize: `${Math.max(14, subSize * 0.5)}px`, color: '#aaaaaa', fontFamily: subFont,
                  background: 'rgba(0,0,0,0.6)', padding: '4px 12px', borderRadius: '6px', textShadow: '0 2px 4px rgba(0,0,0,0.8)' 
                }}>
                  {recognizedText || '인식된 원문이 이곳에 표시됩니다...'}
                </span>

                <span style={{ 
                  whiteSpace: 'pre-wrap', lineHeight: '1.4', 
                  fontSize: `${subSize}px`, color: subColor, fontFamily: subFont, fontWeight: 'bold',
                  background: 'rgba(0,0,0,0.7)', padding: '6px 16px', borderRadius: '8px', textShadow: '0 2px 8px rgba(0,0,0,0.8)' 
                }}>
                  {isTranslating ? '⏳ 번역 중...' : (translatedText || '화면을 분석하고 있습니다...')}
                </span>
              </div>
            )}  

            <div className="glass-panel" style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: '8px', padding: '8px 12px', borderRadius: '12px', alignItems: 'center', zIndex: 30 }}>
              <button onClick={stopCapture} className="fluent-btn danger">⏹ 종료</button>
              <div style={{ width: '1px', height: '20px', background: 'var(--glass-border)', margin: '0 4px' }}></div>
              
              <button onClick={() => setIsPaused(!isPaused)} className={`fluent-btn ${isPaused ? 'primary' : ''}`}>
                {isPaused ? '▶ 재개' : '⏸ 일시정지'}
              </button>
              <div style={{ width: '1px', height: '20px', background: 'var(--glass-border)', margin: '0 4px' }}></div>
              
              <button onClick={() => { 
                const nextMode = !isDragMode;
                setIsDragMode(nextMode); 
                setIsPaused(nextMode); 
                
                // 🚨 핵심: 크롭 재지정 모드로 들어갈 때 텍스트 캐시 완벽 초기화!
                if (nextMode) {
                  setRecognizedText("");
                  setTranslatedText("");
                  lastTextRef.current = "";
                  pendingTextRef.current = null;
                }
              }} className={`fluent-btn ${isDragMode ? 'active-toggle' : ''}`}>
                {isDragMode ? '✔ 영역 확정' : '✂ 크롭 재지정'}
              </button>
              <div style={{ width: '1px', height: '20px', background: 'var(--glass-border)', margin: '0 4px' }}></div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 10px' }}>
                <span style={{ fontWeight: 'bold' }}>{langName.src}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>▶</span>
                <span style={{ fontWeight: 'bold' }}>{langName.tgt}</span>
              </div>
              <div style={{ width: '1px', height: '20px', background: 'var(--glass-border)', margin: '0 4px' }}></div>

              <button onClick={() => setShowSettings(true)} className="fluent-btn">⚙️ 설정</button>
            </div>

            {showSettings && (
              <div className="glass-modal-overlay" onClick={(e) => { if(e.target === e.currentTarget) setShowSettings(false); }}>
                <div className="glass-panel" style={{ width: '600px', height: '400px', borderRadius: '12px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  
                  <div style={{ padding: '15px 20px', borderBottom: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-secondary)' }}>
                    <h2 style={{ margin: 0, fontSize: '1.2rem' }}>환경 설정</h2>
                    <button onClick={() => setShowSettings(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-main)', fontSize: '1.5rem', cursor: 'pointer' }}>&times;</button>
                  </div>

                  <div style={{ display: 'flex', flex: 1, background: 'var(--solid-content)' }}>
                    <div className="tab-menu" style={{ padding: '20px 0 20px 15px', background: 'var(--bg-base)' }}>
                      <button className={`tab-btn ${activeTab === 'general' ? 'active' : ''}`} onClick={() => setActiveTab('general')}>일반</button>
                      <button className={`tab-btn ${activeTab === 'subtitle' ? 'active' : ''}`} onClick={() => setActiveTab('subtitle')}>자막</button>
                      <button className={`tab-btn ${activeTab === 'advanced' ? 'active' : ''}`} onClick={() => setActiveTab('advanced')}>고급</button>
                    </div>

                    <div style={{ flex: 1, padding: '20px 25px', display: 'flex', flexDirection: 'column', gap: '20px', overflowY: 'auto' }}>
                      
                      {activeTab === 'general' && (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <label style={{ fontWeight: 'bold' }}>테마 모드</label>
                            <select value={theme} onChange={e => setTheme(e.target.value)} style={{ padding: '6px', background: 'var(--input-bg)', color: 'var(--text-main)', border: '1px solid var(--glass-border)', borderRadius: '4px' }}>
                              <option value="dark">다크 모드</option>
                              <option value="light">라이트 모드</option>
                            </select>
                          </div>
                          <hr style={{ border: '0', borderTop: '1px solid var(--glass-border)', margin: '10px 0' }}/>
                          <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>AI 스캔 주기 (ms)</label>
                            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '10px', marginTop: 0 }}>낮을수록 화면을 더 자주 검사합니다. (고사양 권장: 300~500)</p>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                              <input type="range" min="300" max="3000" step="100" value={scanInterval} onChange={e => setScanInterval(Number(e.target.value))} style={{ flex: 1, accentColor: '#3182ce' }} />
                              <input type="number" className="num-input" value={scanInterval} onChange={e => setScanInterval(Number(e.target.value))} />
                            </div>
                          </div>
                        </>
                      )}

                      {activeTab === 'subtitle' && (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <label style={{ fontWeight: 'bold' }}>자막 표시 위치</label>
                            <select value={subPosition} onChange={e => setSubPosition(e.target.value)} style={{ padding: '6px', background: 'var(--input-bg)', color: 'var(--text-main)', border: '1px solid var(--glass-border)', borderRadius: '4px' }}>
                              <option value="top">화면 상단 (Top)</option>
                              <option value="bottom">화면 하단 (Bottom)</option>
                            </select>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <label style={{ fontWeight: 'bold' }}>자막 크기 (px)</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <input type="range" min="16" max="64" value={subSize} onChange={e => setSubSize(Number(e.target.value))} style={{ width: '100px', accentColor: '#3182ce' }} />
                              <input type="number" className="num-input" value={subSize} onChange={e => setSubSize(Number(e.target.value))} />
                            </div>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <label style={{ fontWeight: 'bold' }}>자막 색상</label>
                            <input type="color" value={subColor} onChange={e => setSubColor(e.target.value)} style={{ width: '40px', height: '30px', border: 'none', cursor: 'pointer', background: 'transparent' }} />
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <label style={{ fontWeight: 'bold' }}>자막 폰트</label>
                            <select value={subFont} onChange={e => setSubFont(e.target.value)} style={{ padding: '6px', background: 'var(--input-bg)', color: 'var(--text-main)', border: '1px solid var(--glass-border)', borderRadius: '4px' }}>
                              <option value="sans-serif">고딕체 (기본)</option>
                              <option value="serif">명조체</option>
                              <option value="monospace">고정폭</option>
                            </select>
                          </div>
                        </>
                      )}

                      {activeTab === 'advanced' && (
                        <>
                          <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>최대 인식 줄 수</label>
                            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '10px', marginTop: 0 }}>높일수록 두 줄 이상의 자막을 인식합니다.</p>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                              <input type="range" min="1" max="4" step="1" value={maxLines} onChange={e => setMaxLines(Number(e.target.value))} style={{ flex: 1, accentColor: '#3182ce' }} />
                              <input type="number" className="num-input" value={maxLines} onChange={e => setMaxLines(Number(e.target.value))} />
                            </div>
                          </div>

                          <hr style={{ border: '0', borderTop: '1px solid var(--glass-border)', margin: '20px 0' }}/>
                          
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <label style={{ fontWeight: 'bold' }}>디버그용 인식 영역(초록박스) 표시</label>
                            <input 
                              type="checkbox" 
                              checked={showDebugBox} 
                              onChange={e => setShowDebugBox(e.target.checked)} 
                              style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#23a559' }} 
                            />
                          </div>
                          
                          <hr style={{ border: '0', borderTop: '1px solid var(--glass-border)', margin: '20px 0' }}/>

                          <div>
                            <label style={{ fontWeight: 'bold', display: 'block' }}>번역 엔진 상태</label>
                            <div style={{ padding: '12px', background: 'rgba(35, 165, 89, 0.2)', border: '1px solid #23a559', borderRadius: '6px', color: '#23a559', textAlign: 'center', fontWeight: 'bold', marginTop: '10px' }}>
                              ✅ Chrome Built-in AI가 활성화되었습니다.
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

export default App;