fn main() {
    // Embed the same production assets for browser players, including in dev builds.
    let root =
        std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("../dist");
    assert!(
        root.join("index.html").is_file(),
        "Run npm run build before compiling the app"
    );
    let mut assets = String::from("static ASSETS: &[(&str, &[u8])] = &[\n");
    fn collect(root: &std::path::Path, dir: &std::path::Path, out: &mut String) {
        let mut files: Vec<_> = std::fs::read_dir(dir)
            .unwrap()
            .map(|f| f.unwrap().path())
            .collect();
        files.sort();
        for file in files {
            if file.is_dir() {
                collect(root, &file, out);
            } else {
                let name = file
                    .strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/");
                out.push_str(&format!(
                    "({name:?}, include_bytes!({:?})),\n",
                    file.canonicalize().unwrap()
                ));
            }
        }
    }
    collect(&root, &root, &mut assets);
    assets.push_str("];\n");
    std::fs::write(
        std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("lan-assets.rs"),
        assets,
    )
    .unwrap();
    println!("cargo:rerun-if-changed={}", root.display());
    tauri_build::build()
}
