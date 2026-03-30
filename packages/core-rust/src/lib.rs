use wasm_bindgen::prelude::*;

// 브라우저 콘솔 출력을 위한 매크로 설정
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

#[wasm_bindgen]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub fn process_subtitle_frame(width: u32, height: u32, data: &[u8]) -> bool {
    let mut edge_pixel_count = 0;
    let stride = 4; // RGBA
    
    // 연산량 최적화: 모든 픽셀을 다 보지 않고 2개씩 건너뛰며 스캔합니다 (사지방 UHD 630 최적화)
    for y in (1..height - 1).step_by(2) {
        for x in (1..width - 1).step_by(2) {
            let idx = ((y * width) + x) as usize * stride;
            let right_idx = idx + stride;
            let down_idx = idx + (width as usize * stride);

            // 현재 픽셀과 인접 픽셀(오른쪽, 아래)의 밝기 차이 계산
            // 그레이스케일 간이 계산: (R + G + B) / 3
            let curr_avg = (data[idx] as i16 + data[idx+1] as i16 + data[idx+2] as i16) / 3;
            let right_avg = (data[right_idx] as i16 + data[right_idx+1] as i16 + data[right_idx+2] as i16) / 3;
            let down_avg = (data[down_idx] as i16 + data[down_idx+1] as i16 + data[down_idx+2] as i16) / 3;

            // 픽셀 간의 밝기 변화가 크면 '엣지(글자 테두리 등)'로 판단
            if (curr_avg - right_avg).abs() > 40 || (curr_avg - down_avg).abs() > 40 {
                edge_pixel_count += 1;
            }
        }
    }

    // 화면 하단에 엣지(글자 윤곽)가 밀집되어 있는지 확인
    let total_scanned = (width * height) / 4;
    let has_complex_texture = edge_pixel_count > (total_scanned / 200); // 약 0.5%
    log(&format!("스캔 완료! 발견된 엣지 수: {} (기준치: {})", edge_pixel_count, total_scanned / 200));
    has_complex_texture
}