# 🎨 Pixy Studio

### Free, browser-based pixel art editor.
> **Built with Vanilla JS. No frameworks, no logins, no subscriptions.**

---

# 👉 [pixystudio.app](https://pixystudio.app)

<img width="1512" height="861" alt="Ekran Resmi 2026-01-23 22 37 53" src="https://github.com/user-attachments/assets/368d18c8-dfb7-48c7-9338-933c25aeb80a" />


---

## 💭 Why I Built This?
I'm a student who just wanted to draw pixel art on my iPad.

When I looked for apps, I had two choices:
1.  **Pay a monthly subscription** (which I hate).
2.  **Use free apps** that are full of ads and feel like broken toys because they usually aren't the best in terms of UI and UX.

I wanted to build a completely free app that actually feels like software and doesn't make you pay every month to paint some artificial squares. So, I decided to build my own tool. **Pixy Studio** is the result of many sleepless nights. It's designed to be the tool *I* wanted to use: clean, fast, and respectful of the user.

---

## ⚡ How It Works (Universal)
I didn't want to build separate apps for iPad, Mac, and Windows. Instead, I pushed the **modern web browser** to its limits.

Pixy Studio runs entirely on the client-side (in your browser), but it adapts to your device:

* **On iPad:** It behaves like a native tablet app. I implemented **Apple Pencil pressure support**, palm rejection, and touch gestures (pinch-to-zoom, pan) so it feels natural.
* **On Desktop:** It detects your mouse and keyboard, enabling shortcuts (Ctrl+Z, B, E, etc.) and precision cursor control.
* **On Mobile:** The UI shrinks down for quick edits on the go.

---

## 🛠️ Features
I focused on the essentials. No bloat, just the tools you actually need to create game assets or art.

### 🔹 Drawing Modes
I have made 2 drawing modes that can be changed seamlessly:
* **Instant Mode:** The classic experience. Pixels appear immediately as you draw, optimized for speed and traditional asset creation.
* **Progressive Mode:** A more tactile and rhythmic drawing experience. It renders strokes with a progressive flow, providing better visual feedback and a more "organic" feel. It’s designed for artists who want to feel every pixel they place and maintain better control over their line weight.

### 🔹 Layer System
Yes, it has layers. You can:
* Add, delete, and merge layers.
* Toggle visibility to check your progress.
* Move layers up and down.
* *Technical Note:* Layers are rendered as separate off-screen canvases to keep performance high.

### 🔹 The Tools
* **Pen:** Standard pixel brush (Pressure sensitive on supported devices).
* **Eraser:** Hard edge eraser.
* **Bucket Fill:** Classic flood fill algorithm.

### 🔹 Saving & Exporting
* **Offline Mode (PWA):** You can install this as an app on your device. Once loaded, it works 100% offline.
* **Local Storage:** Your current artwork is saved to your browser's IndexedDB.
* **PNG Export:** Exports your art with a transparent background, ready for game engines like Unity or Godot.

---

## 🏗️ Tech Stack
This project was a challenge to myself: **Can I build a complex app without React, Vue, or Angular?**

The answer is yes.
* **Core:** HTML5 Canvas API (2D Context)
* **Logic:** Vanilla JavaScript (ES6 Modules)
* **Styling:** CSS3 (Variables, Flexbox, Grid)
* **Build:** Vite
* **Deploy:** Cloudflare Pages

---

## 🚀 Trying it out
You don't need to install anything. Just click the link below to open the editor in your browser.

**[Open Pixy Studio](https://pixystudio.app)**

## 🤝 Contributing
I'm still learning and improving this. If you find a bug (which is possible!) or have an idea, feel free to open an issue.

*Free for everyone.*
