import argparse
import os
import random
import time
import json
import numpy as np
from pathlib import Path
from tqdm import tqdm

from .rgbe import load_hdr
from .envmap import EnvironmentMap
from .camera import sample_camera_pose
from .render import render_image

def main():
    parser = argparse.ArgumentParser(description="Generate synthetic HDRI-lit cube images.")
    parser.add_argument("--count", type=int, default=10, help="Number of images to generate")
    parser.add_argument("--out", type=str, default="out", help="Output directory")
    parser.add_argument("--width", type=int, default=1280, help="Image width")
    parser.add_argument("--height", type=int, default=720, help="Image height")
    parser.add_argument("--assets", type=str, default="assets/hdri", help="Path to HDRI directory")
    parser.add_argument("--quality", type=str, choices=['fast', 'balanced', 'high'], default='fast', help="Render quality (samples)")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    parser.add_argument("--no-metadata", action="store_true", help="Disable JSON metadata generation")
    
    args = parser.parse_args()
    
    # Setup output
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    
    # Find HDRIs
    hdri_path = Path(args.assets)
    if not hdri_path.exists():
        print(f"Error: Assets directory {hdri_path} not found.")
        return
        
    hdri_files = list(hdri_path.glob("*.hdr"))
    if not hdri_files:
        print(f"Error: No .hdr files found in {hdri_path}.")
        return
        
    print(f"Found {len(hdri_files)} HDRI maps.")
    
    # Initialize RNG
    rng = np.random.default_rng(args.seed)
    
    # Pre-load HDRIs?
    # They might be large (4k). Loading all into memory might crash if there are many.
    # Better to load on demand or cache the last few.
    # Given we random sample, caching might be tricky if we jump around.
    # But usually OS file cache handles re-reads well.
    # However, parsing takes time.
    # Let's load them as we go, or maybe just load one and re-use it if selected again?
    # To optimize, let's keep a cache of loaded EnvironmentMaps, if memory allows.
    # 4K RGBE is 4096*2048*4 bytes ~ 32MB raw, but expanded to float32 is 4096*2048*12 ~ 96MB.
    # 21 files ~ 2GB. That fits in RAM easily on most dev machines.
    # Let's cache them all for speed.
    
    print("Pre-loading HDRIs...")
    env_maps = {}
    for p in tqdm(hdri_files, desc="Loading HDRIs"):
        try:
            data = load_hdr(str(p))
            env_maps[p.name] = EnvironmentMap(data)
        except Exception as e:
            print(f"Failed to load {p}: {e}")
            
    if not env_maps:
        print("No valid HDRIs loaded.")
        return

    hdri_names = list(env_maps.keys())
    
    start_time = time.time()
    
    for i in tqdm(range(args.count), desc="Generating"):
        # Randomize parameters
        hdri_name = rng.choice(hdri_names)
        env_map = env_maps[hdri_name]
        
        cam_pos, cam_target, fov = sample_camera_pose(rng)
        
        # Render
        img = render_image(
            env_map, 
            args.width, 
            args.height, 
            cam_pos, 
            cam_target, 
            fov, 
            quality=args.quality
        )
        
        # Save
        filename_base = f"{i:06d}"
        img_path = out_dir / f"{filename_base}.jpg"
        img.save(img_path, quality=90)
        
        # Metadata
        if not args.no_metadata:
            meta = {
                "id": i,
                "hdri": hdri_name,
                "camera_pos": cam_pos.tolist(),
                "camera_target": cam_target.tolist(),
                "fov": fov,
                "seed": args.seed # This is the global seed, effectively.
            }
            with open(out_dir / f"{filename_base}.json", 'w') as f:
                json.dump(meta, f, indent=2)
                
    elapsed = time.time() - start_time
    print(f"Done. Generated {args.count} images in {elapsed:.2f}s ({elapsed/args.count:.2f}s/img).")

if __name__ == "__main__":
    main()
