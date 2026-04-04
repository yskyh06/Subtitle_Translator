import React from 'react';

interface SettingsModalProps {
  show: boolean;
  onClose: () => void;
  // 일반 설정
  theme: string;
  setTheme: (t: string) => void;
  scanInterval: number;
  setScanInterval: (n: number) => void;
  // 자막 설정
  subPosition: string;
  setSubPosition: (p: string) => void;
  subSize: number;
  setSubSize: (n: number) => void;
  subColor: string;
  setSubColor: (c: string) => void;
  subFont: string;
  setSubFont: (f: string) => void;
  // 고급 설정
  maxLines: number;
  setMaxLines: (n: number) => void;
  showDebugBox: boolean;
  setShowDebugBox: (b: boolean) => void;
  // 탭 상태
  activeTab: string;
  setActiveTab: (t: string) => void;
}

const SettingsModal = ({
  show, onClose, theme, setTheme, scanInterval, setScanInterval,
  subPosition, setSubPosition, subSize, setSubSize, showDebugBox, setShowDebugBox, activeTab, setActiveTab
}: SettingsModalProps) => {
  
  if (!show) return null;

  return (
    <div className="glass-modal-overlay" onClick={(e) => { if(e.target === e.currentTarget) onClose(); }}>
      <div className="glass-panel" style={{ width: '600px', height: '400px', borderRadius: '12px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        
        {/* 상단 헤더 */}
        <div style={{ padding: '15px 20px', borderBottom: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-secondary)' }}>
          <h2 style={{ margin: 0, fontSize: '1.2rem' }}>환경 설정</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-main)', fontSize: '1.5rem', cursor: 'pointer' }}>&times;</button>
        </div>

        {/* 본문 (탭 메뉴 + 설정 내용) */}
        <div style={{ display: 'flex', flex: 1, background: 'var(--solid-content)' }}>
          {/* 왼쪽 탭 메뉴 */}
          <div className="tab-menu" style={{ padding: '20px 0 20px 15px', background: 'var(--bg-base)', width: '140px', borderRight: '1px solid var(--glass-border)' }}>
            <button className={`tab-btn ${activeTab === 'general' ? 'active' : ''}`} onClick={() => setActiveTab('general')}>일반</button>
            <button className={`tab-btn ${activeTab === 'subtitle' ? 'active' : ''}`} onClick={() => setActiveTab('subtitle')}>자막</button>
            <button className={`tab-btn ${activeTab === 'advanced' ? 'active' : ''}`} onClick={() => setActiveTab('advanced')}>고급</button>
          </div>

          {/* 오른쪽 설정 상세 */}
          <div style={{ flex: 1, padding: '20px 25px', display: 'flex', flexDirection: 'column', gap: '20px', overflowY: 'auto' }}>
            {activeTab === 'general' && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontWeight: 'bold' }}>테마 모드</label>
                  <select value={theme} onChange={e => setTheme(e.target.value)} style={{ padding: '6px' }}>
                    <option value="dark">다크 모드</option>
                    <option value="light">라이트 모드</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>AI 스캔 주기 (ms)</label>
                  <input type="range" min="300" max="3000" step="100" value={scanInterval} onChange={e => setScanInterval(Number(e.target.value))} style={{ width: '100%' }} />
                </div>
              </>
            )}

            {activeTab === 'subtitle' && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontWeight: 'bold' }}>자막 위치</label>
                  <select value={subPosition} onChange={e => setSubPosition(e.target.value)} style={{ padding: '6px' }}>
                    <option value="top">상단</option>
                    <option value="bottom">하단</option>
                  </select>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontWeight: 'bold' }}>글자 크기</label>
                  <input type="number" value={subSize} onChange={e => setSubSize(Number(e.target.value))} style={{ width: '60px' }} />
                </div>
              </>
            )}

            {activeTab === 'advanced' && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontWeight: 'bold' }}>디버그 박스 표시</label>
                <input type="checkbox" checked={showDebugBox} onChange={e => setShowDebugBox(e.target.checked)} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;