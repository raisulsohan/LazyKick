# ⚡ LazyKick — The Ultimate Adobe Workflow Companion

<p align="center">
  <img src="https://img.shields.io/badge/Adobe%20After%20Effects-2020--2026+-9999FF?style=for-the-badge&logo=adobeaftereffects&logoColor=white" alt="AE Support" />
  <img src="https://img.shields.io/badge/Adobe%20Premiere%20Pro-2020--2026+-EA77FF?style=for-the-badge&logo=adobepremierepro&logoColor=white" alt="PPro Support" />
  <img src="https://img.shields.io/badge/CEP%20Version-9.0--12.0+-FF5722?style=for-the-badge" alt="CEP Version" />
  <img src="https://img.shields.io/badge/Developed%20By-RaisulSohan-00E676?style=for-the-badge&logo=github" alt="Developer" />
</p>

<p align="center">
  <strong>A unified, lightning-fast CEP extension for Adobe Premiere Pro and After Effects that combines instant clipboard image pasting, real-time project notes with timecode stamping, and automated folder watch bins.</strong>
</p>

<p align="center">
  <a href="https://raisulsohan.com"><strong>🌐 raisulsohan.com</strong></a> • 
  <a href="#-features">Features</a> • 
  <a href="#-installation">Installation</a> • 
  <a href="#-tech-stack">Tech Stack</a> • 
  <a href="#-troubleshooting">Troubleshooting</a>
</p>

---

## 🌟 Overview

**LazyKick** is the all-in-one productivity power tool engineered for video editors and motion designers. It merges three essential workflows into a single, cohesive, dark-themed panel:

1. **Universal QuickPaste**: 1-Click clipboard image pasting directly onto the active timeline with intelligent bin deduplication.
2. **Notes & Interactive Tasks**: Project-aware task checklists, timecode stamps, and a global scratchpad across both Premiere Pro and After Effects.
3. **Watch Bins & Media Sync**: Automated background directory scanning that syncs external asset folders (Downloads, SFX, Client assets) into custom project bins without duplicates.

---

## 🚀 Key Features

### 1. ⚡ Universal QuickPaste (Always-Accessible Header)
* **Instant Timeline Paste**: Copy any image or screenshot to your OS clipboard and hit **`⚡ QuickPaste`**. The image is instantly saved to `<ProjectFolder>/Pasted Images/` and inserted onto your timeline at the current playhead/CTI position.
* **Smart Bin Deduplication**: Prevents project clutter. LazyKick computes image checksums and reuses existing bin items instead of creating duplicate imports.
* **After Effects Intelligence**:
  * Places footage at current CTI.
  * Optional **Guide Layer** mode (won't accidentally render in your final export).
  * Optional **Auto-Fit to Comp** (scales oversized screenshots to fit).
* **Premiere Pro Intelligence**:
  * Places clip on the lowest available video track at the exact playhead position without overwriting existing clips.
* **Recent Pastes Gallery**: Visual thumbnail history of recent clipboard assets with 1-click re-insertion.

### 2. 📝 Notes & Interactive Checklist
* **Project-Aware Auto-Saving**: Automatically loads and isolates notes per project file.
* **Shared AE ↔ PPro Context**: Switching between Premiere and After Effects on the same project seamlessly preserves your notes.
* **🌐 Global Scratchpad**: A dedicated persistent scratchpad available across all projects for client hex codes, hashtags, export presets, and boilerplates.
* **☑️ Interactive Checklist**: Write tasks and click checkboxes to toggle strike-through styling.
* **⏱️ Live Timecode Stamping**: 1-click insertion of the active timeline's exact timecode (e.g., `[00:01:24:12]`) directly into your notes.
* **📋 Copy & 📥 Export**: Fast 1-click clipboard copy or `.txt` file export.

### 3. 📂 Watch Bins & Media Sync (Auto Ingestion)
* **Folder-to-Bin Mapping**: Link local/network folders (e.g., `Downloads`, `Sound Effects`, `Footage`) to specific project bins.
* **Recursive Background Polling**: Scans linked folders every 5 seconds for new media files.
* **Media Type Filters**: Selectively import only Video `[🎬]`, Audio `[🎵]`, or Images `[🖼️]`.
* **Zero Duplicates**: Tracks imported file paths and MD5 signatures to guarantee zero duplicate bin clutter.
* **Built-in Fast Browser**: Lightweight in-panel drive and folder browser with 1-click "Open in Explorer / Finder".

---

## 💻 Installation

### Step 1: Enable PlayerDebugMode (One-Time Setup)

Adobe CEP requires `PlayerDebugMode` enabled to run development/unpacked extensions:

#### **Windows (Fastest)**
Double-click the included [`ENABLE_DEBUG_MODE.bat`](ENABLE_DEBUG_MODE.bat) file inside the `LazyKick` directory.

#### **macOS (Terminal)**
```bash
defaults write com.adobe.CSXS.9 PlayerDebugMode 1
defaults write com.adobe.CSXS.10 PlayerDebugMode 1
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
defaults write com.adobe.CSXS.12 PlayerDebugMode 1
```

---

### Step 2: Deploy to Adobe CEP Extensions Folder

Copy the entire `LazyKick` folder into your system's Adobe CEP directory:

#### **Windows**:
```text
C:\Users\<Your-Username>\AppData\Roaming\Adobe\CEP\extensions\LazyKick
```
> *(Quick shortcut: Press `Win + R`, paste `%APPDATA%\Adobe\CEP\extensions\`, press Enter, and place the folder there)*

#### **macOS**:
```text
~/Library/Application Support/Adobe/CEP/extensions/LazyKick
```

---

### Step 3: Launch in Premiere Pro / After Effects

1. Start (or restart) **Adobe Premiere Pro** or **Adobe After Effects**.
2. Navigate to the top menu bar:
   * **Window > Extensions > LazyKick**
3. Dock the panel anywhere in your workspace.

---

## 🛠️ Tech Stack & Architecture

| Component | Technology | Description |
| :--- | :--- | :--- |
| **CEP Runtime** | Adobe CEP 9.0 – 12.0+ | Cross-application extension container |
| **Client UI** | HTML5, CSS3, Vanilla ES6+ | Modern CC dark-theme responsive UI |
| **Host Engine** | Adobe ExtendScript (ES3) | Native Premiere Pro & After Effects automation |
| **Inter-Process Comm** | `CSInterface.js` | Bi-directional JSON bridge between Client and Host |
| **File I/O & Hashes** | Node.js `fs` & `crypto` | Zero-dependency high-speed image processing & deduplication |

---

## 🔧 Troubleshooting

<details>
<summary><strong>1. "LazyKick" does not appear under Window > Extensions</strong></summary>

* Ensure you ran `ENABLE_DEBUG_MODE.bat` (on Windows) or ran the terminal commands (on macOS).
* Verify that the extension folder is located directly at `%APPDATA%\Adobe\CEP\extensions\LazyKick\` and contains `CSXS/manifest.xml`.
* Completely close and restart Premiere Pro / After Effects.
</details>

<details>
<summary><strong>2. QuickPaste shows "No image in clipboard"</strong></summary>

* Make sure you have an actual raster image copied to your OS clipboard (e.g. using `Win + Shift + S` or right-clicking an image in a browser and choosing *Copy Image*).
* Copying a file path in Windows Explorer is not a clipboard image.
</details>

<details>
<summary><strong>3. Watch Bins auto-sync not importing</strong></summary>

* Ensure the target folder contains supported media extensions (`.mp4`, `.mov`, `.wav`, `.mp3`, `.png`, `.jpg`, etc.).
* Check that the media filter toggle for that file type (Video, Audio, or Image) is enabled on the bin item.
</details>

---

## 👨‍💻 Author & Credits

* **Developer**: **Raisul Sohan**
* **Website**: [https://raisulsohan.com](https://raisulsohan.com)
* **GitHub**: [@raisulsohan](https://github.com/raisulsohan)
* **Suite**: LazySuite Creative Tools Ecosystem
* **License**: Proprietary / Creative Commons — © 2026 Raisul Sohan. All rights reserved.
