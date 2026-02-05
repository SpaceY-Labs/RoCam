import argparse
import os
import sys
import subprocess
import shutil
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(description="Generate synthetic training data using Blender")
    
    # Defaults
    package_dir = Path(__file__).parent
    # Project root is 3 levels up from cli.py: 
    # cli.py in src/training_data_generator/
    # parent -> src/training_data_generator
    # parent.parent -> src/
    # parent.parent.parent -> training-data-generator (root with pyproject.toml)
    project_root = package_dir.parent.parent
    default_hdri_dir = project_root / "assets" / "hdri"
    default_texture_dir = project_root / "assets" / "rocket_texture"
    default_out_dir = project_root / "out"
    blender_script = package_dir / "blender" / "generate.py"

    parser.add_argument("--count", type=int, default=10, help="Number of images to generate")
    parser.add_argument("--out-dir", type=str, default=str(default_out_dir), help="Output directory")
    parser.add_argument("--hdri-dir", type=str, default=str(default_hdri_dir), help="Directory containing HDRI files")
    parser.add_argument("--texture-dir", type=str, default=str(default_texture_dir), help="Directory containing rocket textures")
    parser.add_argument("--seed", type=int, default=None, help="Random seed")
    parser.add_argument("--samples", type=int, default=32, help="Render samples (higher = better quality, slower)")
    parser.add_argument("--blender-app-id", type=str, default="org.blender.Blender", help="Flatpak App ID for Blender")
    
    args = parser.parse_args()

    # Resolve absolute paths because Flatpak might have different CWD issues 
    # (though --filesystem=host handles most, absolute is safer)
    out_dir_abs = Path(args.out_dir).resolve()
    hdri_dir_abs = Path(args.hdri_dir).resolve()
    texture_dir_abs = Path(args.texture_dir).resolve()
    script_abs = blender_script.resolve()

    if not hdri_dir_abs.exists():
        print(f"Error: HDRI directory not found at {hdri_dir_abs}")
        sys.exit(1)

    if not texture_dir_abs.exists():
        print(f"Warning: Texture directory not found at {texture_dir_abs}")

    if not script_abs.exists():
        print(f"Error: Blender script not found at {script_abs}")
        sys.exit(1)

    # Create output directory
    os.makedirs(out_dir_abs, exist_ok=True)
    print(f"Output directory: {out_dir_abs}")
    print(f"HDRI directory: {hdri_dir_abs}")
    print(f"Texture directory: {texture_dir_abs}")

    # Check for flatpak
    if not shutil.which("flatpak"):
        print("Error: 'flatpak' command not found. Please install Flatpak.")
        sys.exit(1)

    # Construct command
    # flatpak run --filesystem=host org.blender.Blender --background --factory-startup --python <script> -- <args>
    cmd = [
        "flatpak", "run",
        "--filesystem=host", 
        args.blender_app_id,
        "--background",
        "--factory-startup",
        "--python", str(script_abs),
        "--",
        "--count", str(args.count),
        "--out-dir", str(out_dir_abs),
        "--hdri-dir", str(hdri_dir_abs),
        "--texture-dir", str(texture_dir_abs),
        "--samples", str(args.samples)
    ]

    if args.seed is not None:
        cmd.extend(["--seed", str(args.seed)])

    print("Running Blender...")
    print(f"Command: {' '.join(cmd)}")
    
    try:
        # Check if the app is installed
        check_cmd = ["flatpak", "info", args.blender_app_id]
        subprocess.run(check_cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except subprocess.CalledProcessError:
        print(f"Error: Flatpak app '{args.blender_app_id}' is not installed.")
        print("Install it with: flatpak install flathub org.blender.Blender")
        sys.exit(1)

    try:
        proc = subprocess.Popen(cmd)
        proc.wait()
        
        if proc.returncode != 0:
            print(f"\nBlender process failed with exit code {proc.returncode}")
            sys.exit(proc.returncode)
            
        print(f"\nSuccessfully generated {args.count} images in {out_dir_abs}")
        
    except KeyboardInterrupt:
        print("\nAborted. Terminating Blender...")
        if 'proc' in locals():
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
        sys.exit(130)
    finally:
        # Ensure Blender is stopped when the script is quitting
        subprocess.run(
            ["flatpak", "kill", args.blender_app_id],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

if __name__ == "__main__":
    main()
