fn main() {
    // Cargo sets TARGET for build scripts, not for the crates they compile.
    // The cross-repo contract test needs to know which target triple it was
    // built for, so the sidecar it looks for is named for that triple. Pass
    // it through as a compile-time environment variable.
    if let Ok(target) = std::env::var("TARGET") {
        println!("cargo:rustc-env=STUDY_STUDIO_TARGET_TRIPLE={target}");
    }

    tauri_build::build();
}
