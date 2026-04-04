import { useRef, useState, useCallback } from 'react';
import * as ort from 'onnxruntime-web';


interface VisionEngineProps {
    maxLines: number;
}

export const useVisionEngine = ({ maxLines }: VisionEngineProps) => {
    const detSessionRef = useRef<ort.InferenceSession | null>(null);
    const ortSessionRef = useRef<ort.InferenceSession | null>(null);
    const isInferencingRef = useRef(false);
    const lastTextRef = useRef("");
    const detectedBoxesRef = useRef<{x: number, y: number, w: number, h: number}[]>([]);
    const charListRef = useRef<string[]>([]);
    const [recognizedText, setRecognizedText] = useState("");

    const initEngine = useCallback(async (detBuffer: ArrayBuffer, recBuffer: ArrayBuffer, charList: string[]) => {
        charListRef.current = charList;
        detSessionRef.current = await ort.InferenceSession.create(detBuffer, { executionProviders: ['webgpu'] });
        ortSessionRef.current = await ort.InferenceSession.create(recBuffer, { executionProviders: ['webgpu'] });
    
        // 예열(Warm-up) 로직도 여기로 이동
        const dummyDet = new ort.Tensor('float32', new Float32Array(1 * 3 * 640 * 640), [1, 3, 640, 640]);
        await detSessionRef.current.run({ [detSessionRef.current.inputNames[0]]: dummyDet });
        const dummyRec = new ort.Tensor('float32', new Float32Array(1 * 3 * 48 * 320), [1, 3, 48, 320]);
        await ortSessionRef.current.run({ [ortSessionRef.current.inputNames[0]]: dummyRec });
    }, []);

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
    
    const processOCR = useCallback(async (img: ImageData) => {
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
                }
                return;
            }
    
            let res = "";
            const btm = await createImageBitmap(img);
    
            for (let k = 0; k < Math.min(boxes.length, maxLines); k++) {
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
    }, [maxLines]);

    return {
        recognizedText,
        detectedBoxesRef,
        setRecognizedText,
        initEngine,
        processOCR,
    };

};