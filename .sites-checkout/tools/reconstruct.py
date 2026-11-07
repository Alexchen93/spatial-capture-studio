#!/usr/bin/env python3
"""Local visual-only 3DGS experiment; it does not generate a collision mesh."""
from __future__ import annotations
import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

REQUIRED = ("colmap", "ffmpeg", "ns-process-data", "ns-train", "ns-export", "nvidia-smi")

def check_dependencies():
    missing = [name for name in REQUIRED if shutil.which(name) is None]
    if missing:
        raise RuntimeError("缺少必要工具：" + ", ".join(missing))
    gpu = subprocess.run(["nvidia-smi", "-L"], capture_output=True, text=True, check=False)
    if gpu.returncode != 0 or not gpu.stdout.strip():
        raise RuntimeError("無法偵測到可用的 NVIDIA GPU；請檢查驅動與 CUDA 環境。")

def run_step(stage, command, workdir):
    print(f"\n[{stage}] 開始", flush=True)
    try:
        subprocess.run(command, cwd=workdir, check=True)
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"{stage}失敗（結束代碼 {exc.returncode}），請檢查上方工具輸出。") from exc

def reconstruct(images, workdir):
    images = images.resolve(strict=True)
    if not images.is_dir():
        raise RuntimeError("照片路徑必須是資料夾。")
    valid = [p for p in images.iterdir() if p.is_file() and p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}]
    if len(valid) < 3:
        raise RuntimeError("照片資料夾至少需要 3 張影像；實際重建通常需要更多重疊照片。")
    workdir = workdir.resolve()
    if workdir == images or images in workdir.parents or workdir in images.parents:
        raise RuntimeError("工作目錄與照片資料夾不得互相包含。")
    if workdir.exists() and (not workdir.is_dir() or any(workdir.iterdir())):
        raise RuntimeError("工作目錄必須不存在或是空資料夾，避免覆寫已有資料。")
    check_dependencies()
    workdir.mkdir(parents=True, exist_ok=True)
    processed, exports = workdir / "processed", workdir / "exports"
    run_step("照片定位", ["ns-process-data", "images", "--data", str(images), "--output-dir", str(processed)], workdir)
    if not (processed / "transforms.json").is_file():
        raise RuntimeError("定位工具未產生 transforms.json，停止處理。")
    run_step("3DGS 訓練", ["ns-train", "splatfacto", "--data", str(processed)], workdir)
    configs = list((workdir / "outputs").rglob("config.yml")) if (workdir / "outputs").exists() else []
    if len(configs) != 1:
        raise RuntimeError(f"預期找到一個訓練設定，實際找到 {len(configs)} 個；未執行匯出。")
    run_step("匯出場景", ["ns-export", "gaussian-splat", "--load-config", str(configs[0]), "--output-dir", str(exports)], workdir)
    files = list(exports.glob("*.ply")) if exports.exists() else []
    if not files or not any(p.stat().st_size > 0 for p in files):
        raise RuntimeError("未找到非空的 PLY 輸出。")
    manifest = {"visual_assets": [str(p.relative_to(workdir)) for p in files], "collision_status": "not_created", "walkable": False}
    (workdir / "result.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\n視覺場景已匯出；碰撞模型、尺度校正與步行檢查仍未完成。", flush=True)

def main():
    parser = argparse.ArgumentParser(description="使用本機已安裝的 Nerfstudio 建立視覺 3DGS；不產生碰撞模型。")
    parser.add_argument("--check", action="store_true", help="只檢查外部工具及 NVIDIA GPU")
    parser.add_argument("--images", type=Path, help="照片資料夾")
    parser.add_argument("--workdir", type=Path, help="空的輸出工作資料夾")
    args = parser.parse_args()
    try:
        if args.check:
            check_dependencies(); print("必要工具與 NVIDIA GPU 已偵測；仍需實際執行驗證。")
        elif args.images and args.workdir:
            reconstruct(args.images, args.workdir)
        else:
            parser.error("請提供 --check，或同時提供 --images 與 --workdir")
    except (OSError, RuntimeError) as exc:
        print(f"錯誤：{exc}", file=sys.stderr); return 1
    return 0
if __name__ == "__main__":
    raise SystemExit(main())
