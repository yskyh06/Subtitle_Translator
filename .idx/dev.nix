{ pkgs, ... }: {
  channel = "unstable"; # 최신 인덱스를 가져오기 위해 잠시 unstable 사용

  packages = [
    pkgs.nodejs_24
    pkgs.pnpm
    pkgs.wasm-pack
    # Rust 관련은 일단 제외하고 빌드 성공부터 시킵니다.
  ];

  idx = {
    # 사용할 확장 프로그램
    extensions = [
      "rust-lang.rust-analyzer"
    ];

    # [핵심] 미리보기 설정 추가
    previews = {
      enable = true;
      previews = {
        web = {
          # Vite 기본 포트인 5173 또는 프로젝트 설정에 맞춘 포트를 사용합니다.
          command = ["npm" "run" "dev" "--" "--port" "$PORT" "--host" "0.0.0.0"];
          manager = "web";
        };
      };
    };
  };

  idx.workspace.onCreate = {}; # 이 부분을 비워두세요.
}